package backend

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// StreamServer provides a local HTTP server that serves either:
//  1) a local downloaded file (preferred), or
//  2) a proxied remote provider URL (with Range support from upstream).
//
// The frontend uses the returned local URL as the <audio src> so we avoid CORS
// and can control headers/range behavior.
type StreamServer struct {
	mu sync.RWMutex

	srv      *http.Server
	listener net.Listener
	baseURL  string
	started  bool

	// token -> streamSource
	streams map[string]*streamSource
}

type streamSource struct {
	createdAt time.Time
	// Exactly one of these should be set
	localPath  string
	remoteURL  string
	remoteHost string
}

func NewStreamServer() *StreamServer {
	return &StreamServer{
		streams: make(map[string]*streamSource),
	}
}

func (s *StreamServer) Start() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.started {
		return
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/stream/", s.handleStream)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		// In a desktop app, we can't return errors from Startup easily here.
		// Fail hard so it surfaces early.
		panic(fmt.Errorf("failed to listen for stream server: %w", err))
	}

	s.listener = ln
	s.srv = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	host := ln.Addr().String()
	s.baseURL = "http://" + host
	s.started = true

	go func() {
		_ = s.srv.Serve(ln)
	}()

	// basic GC for expired tokens
	go s.gcLoop()
}

func (s *StreamServer) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.started {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = s.srv.Shutdown(ctx)
	s.started = false
	s.streams = make(map[string]*streamSource)
}

func (s *StreamServer) BaseURL() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.baseURL
}

// GetStreamURL creates/refreshes a stream token and returns a playable local URL.
//
// Preference:
//  1) If ISRC is provided and a local file exists in downloadDir, serve that.
//  2) Otherwise, resolve the best remote provider URL and proxy it.
func (s *StreamServer) GetStreamURL(spotifyID, isrc, trackName, artistName, albumName, audioFormat, downloadDir string) (string, error) {
	if spotifyID == "" && isrc == "" {
		return "", fmt.Errorf("spotifyID or isrc is required")
	}
	if downloadDir == "" {
		downloadDir = GetDefaultMusicPath()
	}

	// 1) local first
	if isrc != "" {
		if local, ok := CheckISRCExists(downloadDir, isrc); ok {
			tok, err := s.putLocal(local)
			if err != nil {
				return "", err
			}
			return s.BaseURL() + "/stream/" + tok, nil
		}
	}

	// 2) remote resolve
	remote, err := resolveRemoteStreamURL(spotifyID, isrc, audioFormat)
	if err != nil {
		return "", err
	}

	tok, err := s.putRemote(remote)
	if err != nil {
		return "", err
	}
	return s.BaseURL() + "/stream/" + tok, nil
}

func (s *StreamServer) putLocal(path string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.started {
		return "", fmt.Errorf("stream server not started")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	tok := newToken()
	s.streams[tok] = &streamSource{createdAt: time.Now(), localPath: abs}
	return tok, nil
}

func (s *StreamServer) putRemote(rawurl string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.started {
		return "", fmt.Errorf("stream server not started")
	}
	u, err := url.Parse(rawurl)
	if err != nil {
		return "", fmt.Errorf("invalid remote url: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("unsupported remote url scheme: %s", u.Scheme)
	}
	tok := newToken()
	s.streams[tok] = &streamSource{createdAt: time.Now(), remoteURL: rawurl, remoteHost: u.Host}
	return tok, nil
}

func (s *StreamServer) handleStream(w http.ResponseWriter, r *http.Request) {
	// /stream/{token}
	tok := strings.TrimPrefix(r.URL.Path, "/stream/")
	if tok == "" {
		http.NotFound(w, r)
		return
	}

	s.mu.RLock()
	src := s.streams[tok]
	s.mu.RUnlock()
	if src == nil {
		http.NotFound(w, r)
		return
	}

	// prevent long-lived tokens
	if time.Since(src.createdAt) > 2*time.Hour {
		s.mu.Lock()
		delete(s.streams, tok)
		s.mu.Unlock()
		http.NotFound(w, r)
		return
	}

	if src.localPath != "" {
		serveLocalFile(w, r, src.localPath)
		return
	}
	if src.remoteURL != "" {
		proxyRemote(w, r, src.remoteURL)
		return
	}

	http.Error(w, "invalid stream source", http.StatusInternalServerError)
}

func serveLocalFile(w http.ResponseWriter, r *http.Request, path string) {
	f, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			http.NotFound(w, r)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer f.Close()

	st, err := f.Stat()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Some webviews rely on correct content types.
	// Use audio/flac for flac, otherwise octet-stream.
	ct := "application/octet-stream"
	switch strings.ToLower(filepath.Ext(path)) {
	case ".flac":
		ct = "audio/flac"
	case ".m4a":
		ct = "audio/mp4"
	case ".mp3":
		ct = "audio/mpeg"
	case ".wav":
		ct = "audio/wav"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", st.Size()))
	w.Header().Set("Cache-Control", "no-store")

	http.ServeContent(w, r, filepath.Base(path), st.ModTime(), f)
}

func proxyRemote(w http.ResponseWriter, r *http.Request, rawurl string) {
	up, err := url.Parse(rawurl)
	if err != nil {
		http.Error(w, "bad upstream url", http.StatusBadRequest)
		return
	}

	// Copy request to upstream
	ureq, err := http.NewRequestWithContext(r.Context(), r.Method, up.String(), nil)
	if err != nil {
		http.Error(w, "failed to build upstream request", http.StatusInternalServerError)
		return
	}

	// Forward Range for seek.
	if rg := r.Header.Get("Range"); rg != "" {
		ureq.Header.Set("Range", rg)
	}
	ureq.Header.Set("User-Agent", "SpotiFLAC-StreamProxy/1.0")

	client := &http.Client{Timeout: 0}
	resp, err := client.Do(ureq)
	if err != nil {
		http.Error(w, "upstream error", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// Propagate key headers.
	for _, h := range []string{"Content-Type", "Content-Length", "Accept-Ranges", "Content-Range"} {
		if v := resp.Header.Get(h); v != "" {
			w.Header().Set(h, v)
		}
	}

	// Fallback content-type if upstream didn't send it (helps HTMLAudio element).
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "audio/mpeg")
	}

	// If upstream doesn't advertise ranges, still advertise to the client;
	// some players will attempt Range anyway.
	if w.Header().Get("Accept-Ranges") == "" {
		w.Header().Set("Accept-Ranges", "bytes")
	}

	w.Header().Set("Cache-Control", "no-store")

	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func resolveRemoteStreamURL(spotifyID, isrc, audioFormat string) (string, error) {
	// This project already has a SongLink client + provider downloaders.
	// For now, use SongLink to pick a provider URL and then ask the provider
	// downloader to give us a direct streamable URL.
	//
	// NOTE: Many provider URLs will not be directly playable without auth.
	// We keep this function conservative: resolve to "some" URL and let
	// future work enrich this with provider-auth headers or signed urls.
	client := NewSongLinkClient()
	urls, err := client.GetAllURLsFromSpotify(spotifyID)
	if err != nil {
		return "", err
	}

	// Prefer Tidal, then Amazon.
	// (SongLinkURLs in this repo currently exposes only Tidal + Amazon.)
	if urls.TidalURL != "" {
		return urls.TidalURL, nil
	}
	if urls.AmazonURL != "" {
		return urls.AmazonURL, nil
	}

	_ = isrc
	_ = audioFormat
	return "", fmt.Errorf("no provider url available")
}

func newToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *StreamServer) gcLoop() {
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		s.mu.Lock()
		for k, v := range s.streams {
			if time.Since(v.createdAt) > 2*time.Hour {
				delete(s.streams, k)
			}
		}
		s.mu.Unlock()
	}
}

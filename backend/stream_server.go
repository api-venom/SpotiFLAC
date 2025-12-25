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
	"strconv"
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
	setStreamCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

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

func setStreamCORSHeaders(w http.ResponseWriter, r *http.Request) {
	// The frontend uses HTMLAudioElement with crossOrigin="anonymous".
	// When the app origin differs from the stream server origin, Chromium/WebView2
	// requires CORS headers for media loads (otherwise it often surfaces as
	// MEDIA_ERR_SRC_NOT_SUPPORTED).
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		// Ensure caches keep per-origin variants separate.
		w.Header().Add("Vary", "Origin")
	} else {
		w.Header().Set("Access-Control-Allow-Origin", "*")
	}

	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Range")
	w.Header().Set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length, Content-Type")
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

	// Force GET for upstream (audio elements will always GET, but some upstreams
	// don’t like other verbs).
	ureq.Method = http.MethodGet

	// Forward Range for seek.
	if rg := r.Header.Get("Range"); rg != "" {
		ureq.Header.Set("Range", rg)
	}

	// Some CDNs require a fairly normal accept header.
	ureq.Header.Set("Accept", "*/*")
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
	if ct := strings.TrimSpace(w.Header().Get("Content-Type")); ct == "" || strings.EqualFold(ct, "application/octet-stream") {
		if inferred := contentTypeFromPath(up.Path); inferred != "" {
			w.Header().Set("Content-Type", inferred)
		}
	}

	// If upstream doesn't advertise ranges, still advertise to the client;
	// some players will attempt Range anyway.
	if w.Header().Get("Accept-Ranges") == "" {
		w.Header().Set("Accept-Ranges", "bytes")
	}

	w.Header().Set("Cache-Control", "no-store")

	// If upstream is returning HTML, the browser audio element will reject it.
	// Convert to a clear error here so the client sees a failure.
	if strings.Contains(strings.ToLower(w.Header().Get("Content-Type")), "text/html") {
		http.Error(w, "upstream returned html (not an audio stream)", http.StatusBadGateway)
		return
	}

	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func contentTypeFromPath(p string) string {
	switch strings.ToLower(filepath.Ext(p)) {
	case ".flac":
		return "audio/flac"
	case ".m4a":
		return "audio/mp4"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".ogg":
		return "audio/ogg"
	case ".opus":
		return "audio/opus"
	default:
		return ""
	}
}

func resolveRemoteStreamURL(spotifyID, isrc, audioFormat string) (string, error) {
	// Get Tidal URL from SongLink, then use Tidal API to get actual stream URL
	client := NewSongLinkClient()
	urls, err := client.GetAllURLsFromSpotify(spotifyID)
	if err != nil {
		return "", fmt.Errorf("failed to resolve provider URLs: %w", err)
	}

	// Try Tidal first - use the downloader's GetTidalFileURL method to get stream URL
	if urls.TidalURL != "" {
		// Extract Tidal track ID from URL
		trackID, err := extractTidalTrackID(urls.TidalURL)
		if err != nil {
			return "", fmt.Errorf("invalid Tidal URL format: %w", err)
		}
		
		// Use Tidal downloader to get authenticated stream URL
		downloader := NewTidalDownloader("")
		quality := audioFormat
		if quality == "" {
			quality = "LOSSLESS"
		}
		
		// Get stream URL using the new method
		streamURL, err := downloader.GetTidalFileURL(trackID, quality)
		if err != nil {
			return "", fmt.Errorf("failed to get Tidal stream URL: %w", err)
		}
		
		// If the stream URL is a manifest (DASH/BTS format), parse it to get the direct URL
		if strings.HasPrefix(streamURL, "MANIFEST:") {
			manifestB64 := strings.TrimPrefix(streamURL, "MANIFEST:")
			directURL, _, _, err := parseManifest(manifestB64)
			if err != nil {
				return "", fmt.Errorf("failed to parse Tidal manifest: %w", err)
			}
			if directURL == "" {
				return "", fmt.Errorf("manifest contains DASH segments (not supported for streaming, download recommended)")
			}
			return directURL, nil
		}
		
		return streamURL, nil
	}

	// Amazon not yet supported
	if urls.AmazonURL != "" {
		return "", fmt.Errorf("amazon streaming not yet implemented")
	}

	return "", fmt.Errorf("no provider URL available")
}

func extractTidalTrackID(tidalURL string) (int64, error) {
	// Extract track ID from URLs like:
	// https://listen.tidal.com/track/123456
	// https://tidal.com/browse/track/123456
	parts := strings.Split(tidalURL, "/track/")
	if len(parts) != 2 {
		return 0, fmt.Errorf("URL does not contain /track/")
	}
	// Remove any query parameters
	trackIDStr := strings.Split(parts[1], "?")[0]
	trackID, err := strconv.ParseInt(trackIDStr, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("failed to parse track ID: %w", err)
	}
	return trackID, nil
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

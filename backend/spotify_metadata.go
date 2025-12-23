package backend

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	spotifyTokenURL       = "https://open.spotify.com/api/token"
	spotifyLegacyTokenURL = "https://open.spotify.com/get_access_token"
	spotifyAccessPointURL = "https://open.spotify.com/get_access_token?reason=transport&productType=web_player"
	playlistBaseURL       = "https://api.spotify.com/v1/playlists/%s"
	albumBaseURL          = "https://api.spotify.com/v1/albums/%s"
	trackBaseURL          = "https://api.spotify.com/v1/tracks/%s"
	artistBaseURL         = "https://api.spotify.com/v1/artists/%s"
	artistAlbumsBaseURL   = "https://api.spotify.com/v1/artists/%s/albums"
	secretBytesRemotePath = "https://cdn.jsdelivr.net/gh/afkarxyz/secretBytes@refs/heads/main/secrets/secretBytes.json"
)

var (
	errInvalidSpotifyURL = errors.New("invalid or unsupported Spotify URL")
)

func spotifyDebugEnabled() bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv("SPOTIFLAC_SPOTIFY_DEBUG")))
	return v == "1" || v == "true" || v == "yes" || v == "on"
}

func spotifyDebugf(format string, args ...any) {
	if !spotifyDebugEnabled() {
		return
	}
	fmt.Printf("[spotify-debug] "+format+"\n", args...)
}

func spotifyPreviewBody(body []byte, max int) string {
	if max <= 0 || len(body) == 0 {
		return ""
	}
	s := strings.TrimSpace(string(body))
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\t", " ")
	for strings.Contains(s, "  ") {
		s = strings.ReplaceAll(s, "  ", " ")
	}
	if len(s) > max {
		return s[:max] + "…"
	}
	return s
}

func redactSpotifyTokenURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	q := u.Query()
	if q.Has("totp") {
		q.Set("totp", "***")
	}
	u.RawQuery = q.Encode()
	return u.String()
}

// SpotifyMetadataClient mirrors the behaviour of Doc/getMetadata.py and interacts with Spotify's web API.
type SpotifyMetadataClient struct {
	httpClient *http.Client
	rng        *rand.Rand
	rngMu      sync.Mutex
	userAgent  string

	cacheMu       sync.Mutex
	responseCache map[string]spotifyCachedResponse
	inflight      map[string]*spotifyInflight
	cacheTTL      time.Duration

	rateLimitMu     sync.Mutex
	cooldownUntil   map[string]time.Time
	backoff         map[string]time.Duration
	lastRequestTime map[string]time.Time
	minInterval     time.Duration

	tokenMu            sync.Mutex
	cachedAccessToken  string
	cachedTokenUntil   time.Time

	secretsMu        sync.Mutex
	cachedSecrets    []secretEntry
	cachedSecretsAt  time.Time
	cachedSecretsTTL time.Duration

	serverTimeMu          sync.Mutex
	cachedServerTime      int64
	cachedServerTimeIsMS  bool
	cachedServerTimeAt    time.Time
	cachedServerTimeTTL   time.Duration
}

type spotifyCachedResponse struct {
	body      []byte
	expiresAt time.Time
}

type spotifyInflight struct {
	done chan struct{}
	body []byte
	err  error
}

// NewSpotifyMetadataClient creates a ready-to-use client with sane defaults.
func NewSpotifyMetadataClient() *SpotifyMetadataClient {
	src := rand.NewSource(time.Now().UnixNano())
	c := &SpotifyMetadataClient{
		httpClient: &http.Client{Timeout: 15 * time.Second},
		rng:        rand.New(src),
	}
	c.cooldownUntil = map[string]time.Time{}
	c.backoff = map[string]time.Duration{}
	c.lastRequestTime = map[string]time.Time{}
	c.minInterval = 250 * time.Millisecond
	c.cachedSecretsTTL = 6 * time.Hour
	c.cachedServerTimeTTL = 5 * time.Minute
	c.userAgent = c.randomUserAgent()
	c.responseCache = map[string]spotifyCachedResponse{}
	c.inflight = map[string]*spotifyInflight{}
	c.cacheTTL = 10 * time.Minute
	return c
}

var defaultSpotifyMetadataClient = NewSpotifyMetadataClient()

func (c *SpotifyMetadataClient) clearTokenCache() {
	c.tokenMu.Lock()
	c.cachedAccessToken = ""
	c.cachedTokenUntil = time.Time{}
	c.tokenMu.Unlock()
}

func (c *SpotifyMetadataClient) cacheToken(token string, until time.Time) {
	if strings.TrimSpace(token) == "" {
		return
	}
	c.tokenMu.Lock()
	c.cachedAccessToken = token
	c.cachedTokenUntil = until
	c.tokenMu.Unlock()
}

func (c *SpotifyMetadataClient) getCachedToken() (string, bool) {
	c.tokenMu.Lock()
	defer c.tokenMu.Unlock()
	if c.cachedAccessToken == "" {
		return "", false
	}
	if !c.cachedTokenUntil.IsZero() && time.Now().Before(c.cachedTokenUntil) {
		return c.cachedAccessToken, true
	}
	return "", false
}

func (c *SpotifyMetadataClient) normalizeServerTimeUnits(serverTime int64) (isMS bool, nowUnit int64) {
	// Spotify sometimes returns seconds; protect against ms.
	if serverTime > 1_000_000_000_000 {
		return true, time.Now().UnixMilli()
	}
	return false, time.Now().Unix()
}

func (c *SpotifyMetadataClient) getServerTimeCached(ctx context.Context) (int64, error) {
	c.serverTimeMu.Lock()
	if c.cachedServerTime != 0 && !c.cachedServerTimeAt.IsZero() && time.Since(c.cachedServerTimeAt) <= c.cachedServerTimeTTL {
		base := c.cachedServerTime
		isMS := c.cachedServerTimeIsMS
		at := c.cachedServerTimeAt
		c.serverTimeMu.Unlock()

		elapsed := time.Since(at)
		if isMS {
			return base + elapsed.Milliseconds(), nil
		}
		return base + int64(elapsed.Seconds()), nil
	}
	c.serverTimeMu.Unlock()

	serverTime, err := c.fetchServerTime(ctx)
	if err != nil {
		return 0, err
	}
	isMS, _ := c.normalizeServerTimeUnits(serverTime)
	c.serverTimeMu.Lock()
	c.cachedServerTime = serverTime
	c.cachedServerTimeIsMS = isMS
	c.cachedServerTimeAt = time.Now()
	c.serverTimeMu.Unlock()
	return serverTime, nil
}

func spotifyTokenExpiryFromPayload(p accessTokenResponse) time.Time {
	// Prefer explicit expiry if present.
	if p.AccessTokenExpirationTimestampMs > 0 {
		return time.UnixMilli(p.AccessTokenExpirationTimestampMs)
	}
	if p.ExpiresIn > 0 {
		return time.Now().Add(time.Duration(p.ExpiresIn) * time.Second)
	}
	// Fallback: web player tokens are typically long-lived; be conservative.
	return time.Now().Add(45 * time.Minute)
}

// TrackMetadata mirrors the filtered track payload returned by the Python script.
type TrackMetadata struct {
	SpotifyID   string `json:"spotify_id,omitempty"`
	Artists     string `json:"artists"`
	Name        string `json:"name"`
	AlbumName   string `json:"album_name"`
	AlbumArtist string `json:"album_artist,omitempty"`
	DurationMS  int    `json:"duration_ms"`
	Images      string `json:"images"`
	ReleaseDate string `json:"release_date"`
	TrackNumber int    `json:"track_number"`
	TotalTracks int    `json:"total_tracks,omitempty"`
	DiscNumber  int    `json:"disc_number,omitempty"`
	ExternalURL string `json:"external_urls"`
	ISRC        string `json:"isrc"`
}

// ArtistSimple holds basic artist info for clickable artists
type ArtistSimple struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	ExternalURL string `json:"external_urls"`
}

// AlbumTrackMetadata holds per-track info for album / playlist formatting.
type AlbumTrackMetadata struct {
	SpotifyID   string         `json:"spotify_id,omitempty"`
	Artists     string         `json:"artists"`
	Name        string         `json:"name"`
	AlbumName   string         `json:"album_name"`
	AlbumArtist string         `json:"album_artist,omitempty"`
	DurationMS  int            `json:"duration_ms"`
	Images      string         `json:"images"`
	ReleaseDate string         `json:"release_date"`
	TrackNumber int            `json:"track_number"`
	TotalTracks int            `json:"total_tracks,omitempty"`
	DiscNumber  int            `json:"disc_number,omitempty"`
	ExternalURL string         `json:"external_urls"`
	ISRC        string         `json:"isrc"`
	AlbumType   string         `json:"album_type,omitempty"`
	AlbumID     string         `json:"album_id,omitempty"`
	AlbumURL    string         `json:"album_url,omitempty"`
	ArtistID    string         `json:"artist_id,omitempty"`
	ArtistURL   string         `json:"artist_url,omitempty"`
	ArtistsData []ArtistSimple `json:"artists_data,omitempty"`
}

type TrackResponse struct {
	Track TrackMetadata `json:"track"`
}

type AlbumInfoMetadata struct {
	TotalTracks int    `json:"total_tracks"`
	Name        string `json:"name"`
	ReleaseDate string `json:"release_date"`
	Artists     string `json:"artists"`
	Images      string `json:"images"`
	Batch       string `json:"batch,omitempty"`
	ArtistID    string `json:"artist_id,omitempty"`
	ArtistURL   string `json:"artist_url,omitempty"`
}

type AlbumResponsePayload struct {
	AlbumInfo AlbumInfoMetadata    `json:"album_info"`
	TrackList []AlbumTrackMetadata `json:"track_list"`
}

type PlaylistInfoMetadata struct {
	Tracks struct {
		Total int `json:"total"`
	} `json:"tracks"`
	Followers struct {
		Total int `json:"total"`
	} `json:"followers"`
	Owner struct {
		DisplayName string `json:"display_name"`
		Name        string `json:"name"`
		Images      string `json:"images"`
	} `json:"owner"`
	Batch string `json:"batch,omitempty"`
}

type PlaylistResponsePayload struct {
	PlaylistInfo PlaylistInfoMetadata `json:"playlist_info"`
	TrackList    []AlbumTrackMetadata `json:"track_list"`
}

type ArtistInfoMetadata struct {
	Name            string   `json:"name"`
	Followers       int      `json:"followers"`
	Genres          []string `json:"genres"`
	Images          string   `json:"images"`
	ExternalURL     string   `json:"external_urls"`
	DiscographyType string   `json:"discography_type"`
	TotalAlbums     int      `json:"total_albums"`
	Batch           string   `json:"batch,omitempty"`
}

type DiscographyAlbumMetadata struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	AlbumType   string `json:"album_type"`
	ReleaseDate string `json:"release_date"`
	TotalTracks int    `json:"total_tracks"`
	Artists     string `json:"artists"`
	Images      string `json:"images"`
	ExternalURL string `json:"external_urls"`
}

type ArtistDiscographyPayload struct {
	ArtistInfo ArtistInfoMetadata         `json:"artist_info"`
	AlbumList  []DiscographyAlbumMetadata `json:"album_list"`
	TrackList  []AlbumTrackMetadata       `json:"track_list"`
}

type ArtistResponsePayload struct {
	Artist struct {
		Name        string   `json:"name"`
		Followers   int      `json:"followers"`
		Genres      []string `json:"genres"`
		Images      string   `json:"images"`
		ExternalURL string   `json:"external_urls"`
		Popularity  int      `json:"popularity"`
	} `json:"artist"`
}

type spotifyURI struct {
	Type             string
	ID               string
	DiscographyGroup string
}

type secretEntry struct {
	Version int   `json:"version"`
	Secret  []int `json:"secret"`
}

type serverTimeResponse struct {
	ServerTime int64 `json:"serverTime"`
}

type accessTokenResponse struct {
	AccessToken                     string `json:"accessToken"`
	ExpiresIn                        int    `json:"expiresIn,omitempty"`
	AccessTokenExpirationTimestampMs int64  `json:"accessTokenExpirationTimestampMs,omitempty"`
}

type image struct {
	URL string `json:"url"`
}

type externalURL struct {
	Spotify string `json:"spotify"`
}

type externalID struct {
	ISRC string `json:"isrc"`
}

type artist struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type albumSimplified struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	AlbumType   string      `json:"album_type"`
	ReleaseDate string      `json:"release_date"`
	TotalTracks int         `json:"total_tracks"`
	Images      []image     `json:"images"`
	ExternalURL externalURL `json:"external_urls"`
	Artists     []artist    `json:"artists"`
}

type trackSimplified struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	DurationMS  int         `json:"duration_ms"`
	TrackNumber int         `json:"track_number"`
	DiscNumber  int         `json:"disc_number"`
	ExternalURL externalURL `json:"external_urls"`
	Artists     []artist    `json:"artists"`
}

type trackFull struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	DurationMS  int             `json:"duration_ms"`
	TrackNumber int             `json:"track_number"`
	DiscNumber  int             `json:"disc_number"`
	ExternalURL externalURL     `json:"external_urls"`
	ExternalID  externalID      `json:"external_ids"`
	Album       albumSimplified `json:"album"`
	Artists     []artist        `json:"artists"`
}

type playlistTrackItem struct {
	Track *trackFull `json:"track"`
}

type playlistResponse struct {
	Name   string  `json:"name"`
	Images []image `json:"images"`
	Owner  struct {
		DisplayName string `json:"display_name"`
	} `json:"owner"`
	Followers struct {
		Total int `json:"total"`
	} `json:"followers"`
	Tracks struct {
		Items []playlistTrackItem `json:"items"`
		Next  string              `json:"next"`
		Total int                 `json:"total"`
	} `json:"tracks"`
}

type albumResponse struct {
	Name        string   `json:"name"`
	ReleaseDate string   `json:"release_date"`
	TotalTracks int      `json:"total_tracks"`
	Images      []image  `json:"images"`
	Artists     []artist `json:"artists"`
	Tracks      struct {
		Items []trackSimplified `json:"items"`
		Next  string            `json:"next"`
	} `json:"tracks"`
}

type artistResponse struct {
	Name      string `json:"name"`
	Followers struct {
		Total int `json:"total"`
	} `json:"followers"`
	Genres      []string    `json:"genres"`
	Images      []image     `json:"images"`
	ExternalURL externalURL `json:"external_urls"`
	Popularity  int         `json:"popularity"`
}

type playlistRaw struct {
	Data         playlistResponse
	BatchEnabled bool
	BatchCount   int
}

type albumRaw struct {
	Data         albumResponse
	Token        string
	BatchEnabled bool
	BatchCount   int
}

type discographyRaw struct {
	Artist       artistResponse
	Albums       []albumSimplified
	Token        string
	Discography  string
	BatchEnabled bool
	BatchCount   int
}

// GetFilteredSpotifyData is a convenience wrapper that mirrors the Python module's entry point.
func GetFilteredSpotifyData(ctx context.Context, spotifyURL string, batch bool, delay time.Duration) (interface{}, error) {
	return defaultSpotifyMetadataClient.GetFilteredData(ctx, spotifyURL, batch, delay)
}

func (c *SpotifyMetadataClient) getHostFromURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(u.Host))
}

func (c *SpotifyMetadataClient) enforceRateLimitGate(ctx context.Context, host string) error {
	if host == "" {
		return nil
	}

	maxWait := spotifyMaxWaitFromContext(ctx)

	for {
		now := time.Now()
		var sleepFor time.Duration
		var cooldownUntil time.Time

		c.rateLimitMu.Lock()
		if until, ok := c.cooldownUntil[host]; ok && until.After(now) {
			sleepFor = time.Until(until)
			cooldownUntil = until
			c.rateLimitMu.Unlock()
			// If the remaining wait is small (or within our timeout budget), just wait and continue.
			if sleepFor <= 3*time.Second || (maxWait > 0 && sleepFor <= maxWait) {
				if err := sleepWithContext(ctx, sleepFor); err != nil {
					return err
				}
				continue
			}
			return fmt.Errorf("spotify rate limited: cooldown active host=%s wait=%s until=%s", host, sleepFor.Round(time.Second), cooldownUntil.Format(time.RFC3339))
		}

		// Gentle pacing even when not rate-limited.
		if last, ok := c.lastRequestTime[host]; ok && !last.IsZero() {
			gap := now.Sub(last)
			if gap < c.minInterval {
				sleepFor = c.minInterval - gap
			}
		}
		c.lastRequestTime[host] = now
		c.rateLimitMu.Unlock()

		if sleepFor > 0 {
			if err := sleepWithContext(ctx, sleepFor); err != nil {
				return err
			}
			continue
		}
		return nil
	}
}

func spotifyMaxWaitFromContext(ctx context.Context) time.Duration {
	if ctx == nil {
		return 0
	}
	if deadline, ok := ctx.Deadline(); ok {
		budget := time.Until(deadline) - 2*time.Second
		if budget < 0 {
			return 0
		}
		// Cap to avoid extremely long waits in case callers pass huge timeouts.
		if budget > 2*time.Minute {
			budget = 2 * time.Minute
		}
		return budget
	}
	// No deadline: be conservative.
	return 90 * time.Second
}

func (c *SpotifyMetadataClient) getCachedResponse(endpoint string) ([]byte, bool) {
	if endpoint == "" {
		return nil, false
	}
	if c.cacheTTL <= 0 {
		return nil, false
	}
	now := time.Now()
	c.cacheMu.Lock()
	entry, ok := c.responseCache[endpoint]
	if !ok || entry.expiresAt.IsZero() || now.After(entry.expiresAt) || len(entry.body) == 0 {
		if ok {
			delete(c.responseCache, endpoint)
		}
		c.cacheMu.Unlock()
		return nil, false
	}
	body := make([]byte, len(entry.body))
	copy(body, entry.body)
	c.cacheMu.Unlock()
	return body, true
}

func (c *SpotifyMetadataClient) cacheResponse(endpoint string, body []byte) {
	if endpoint == "" || len(body) == 0 || c.cacheTTL <= 0 {
		return
	}
	c.cacheMu.Lock()
	c.responseCache[endpoint] = spotifyCachedResponse{body: append([]byte(nil), body...), expiresAt: time.Now().Add(c.cacheTTL)}
	c.cacheMu.Unlock()
}

func (c *SpotifyMetadataClient) getOrFetchBody(ctx context.Context, endpoint, token string) ([]byte, error) {
	if body, ok := c.getCachedResponse(endpoint); ok {
		spotifyDebugf("api cache hit %s", endpoint)
		return body, nil
	}

	c.cacheMu.Lock()
	if inflight, ok := c.inflight[endpoint]; ok {
		done := inflight.done
		c.cacheMu.Unlock()
		select {
		case <-done:
			return inflight.body, inflight.err
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	call := &spotifyInflight{done: make(chan struct{})}
	c.inflight[endpoint] = call
	c.cacheMu.Unlock()

	defer func() {
		c.cacheMu.Lock()
		delete(c.inflight, endpoint)
		c.cacheMu.Unlock()
		select {
		case <-call.done:
		default:
			close(call.done)
		}
	}()

	body, err := c.fetchJSONBody(ctx, endpoint, token)
	call.body = body
	call.err = err
	if err == nil {
		c.cacheResponse(endpoint, body)
	}
	return body, err
}

func (c *SpotifyMetadataClient) noteRateLimited(host string, retryAfter time.Duration) (time.Time, time.Duration) {
	if host == "" {
		return time.Time{}, 0
	}
	if retryAfter <= 0 {
		retryAfter = 5 * time.Second
	}

	const maxBackoff = 10 * time.Minute
	const buffer = 5 * time.Second

	now := time.Now()

	c.rateLimitMu.Lock()
	defer c.rateLimitMu.Unlock()

	prev := c.backoff[host]
	backoff := retryAfter
	if prev > 0 {
		backoff = prev * 2
		if backoff < retryAfter {
			backoff = retryAfter
		}
	}
	if backoff > maxBackoff {
		backoff = maxBackoff
	}
	// Add a small buffer so "retry-after=60" doesn't instantly 429 again due to clock skew.
	until := now.Add(backoff + buffer)

	if existing := c.cooldownUntil[host]; existing.After(until) {
		until = existing
	}

	c.backoff[host] = backoff
	c.cooldownUntil[host] = until
	return until, backoff
}

// GetFilteredData fetches, normalises, and formats Spotify payloads for the given URL.
func (c *SpotifyMetadataClient) GetFilteredData(ctx context.Context, spotifyURL string, batch bool, delay time.Duration) (interface{}, error) {
	spotifyDebugf("GetFilteredData url=%q batch=%v delay=%s", spotifyURL, batch, delay)

	parsed, err := parseSpotifyURI(spotifyURL)
	if err != nil {
		spotifyDebugf("parseSpotifyURI failed: %v", err)
		return nil, err
	}
	spotifyDebugf("parsed uri type=%q id=%q discography=%q", parsed.Type, parsed.ID, parsed.DiscographyGroup)

	token, err := c.getAccessToken(ctx)
	if err != nil {
		spotifyDebugf("getAccessToken failed: %v", err)
		return nil, err
	}
	spotifyDebugf("access token acquired (len=%d)", len(token))

	raw, err := c.getRawSpotifyData(ctx, parsed, token, batch, delay)
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "unauthorized (401)") {
		// Token expired/invalid; refresh once and retry.
		spotifyDebugf("api unauthorized; refreshing token and retrying once")
		c.clearTokenCache()
		refreshed, tokenErr := c.getAccessToken(ctx)
		if tokenErr == nil && refreshed != "" {
			raw, err = c.getRawSpotifyData(ctx, parsed, refreshed, batch, delay)
		}
	}
	if err != nil {
		spotifyDebugf("getRawSpotifyData failed: %v", err)
		return nil, err
	}

	return c.processSpotifyData(ctx, raw)
}

func (c *SpotifyMetadataClient) getRawSpotifyData(ctx context.Context, parsed spotifyURI, token string, batch bool, delay time.Duration) (interface{}, error) {
	switch parsed.Type {
	case "playlist":
		return c.fetchPlaylist(ctx, parsed.ID, token, batch, delay)
	case "album":
		return c.fetchAlbum(ctx, parsed.ID, token, batch, delay)
	case "track":
		return c.fetchTrack(ctx, parsed.ID, token)
	case "artist_discography":
		return c.fetchArtistDiscography(ctx, parsed, token, batch, delay)
	case "artist":
		return c.fetchArtist(ctx, parsed.ID, token)
	default:
		return nil, fmt.Errorf("unsupported Spotify type: %s", parsed.Type)
	}
}

func (c *SpotifyMetadataClient) processSpotifyData(ctx context.Context, raw interface{}) (interface{}, error) {
	switch payload := raw.(type) {
	case *playlistRaw:
		return c.formatPlaylistData(payload), nil
	case *albumRaw:
		return c.formatAlbumData(ctx, payload)
	case *trackFull:
		trackPayload := formatTrackData(payload)
		return trackPayload, nil
	case *discographyRaw:
		return c.formatArtistDiscographyData(ctx, payload)
	case *artistResponse:
		formatted := formatArtistData(payload)
		return formatted, nil
	default:
		return nil, errors.New("unknown raw payload type")
	}
}

func (c *SpotifyMetadataClient) fetchPlaylist(ctx context.Context, playlistID, token string, batch bool, delay time.Duration) (*playlistRaw, error) {
	var data playlistResponse
	if err := c.getJSON(ctx, fmt.Sprintf(playlistBaseURL, playlistID), token, &data); err != nil {
		return nil, err
	}

	tracksURL := fmt.Sprintf("https://api.spotify.com/v1/playlists/%s/tracks?limit=100", playlistID)
	var items []playlistTrackItem
	batchDelay := time.Duration(0)
	if batch {
		batchDelay = delay
	}
	batches, err := fetchPaging(ctx, c, tracksURL, token, batchDelay, &items)
	if err != nil {
		return nil, err
	}
	if len(items) > 0 {
		data.Tracks.Items = items
	}

	return &playlistRaw{
		Data:         data,
		BatchEnabled: batch,
		BatchCount:   batches,
	}, nil
}

func (c *SpotifyMetadataClient) fetchAlbum(ctx context.Context, albumID, token string, batch bool, delay time.Duration) (*albumRaw, error) {
	var data albumResponse
	if err := c.getJSON(ctx, fmt.Sprintf(albumBaseURL, albumID), token, &data); err != nil {
		return nil, err
	}

	tracksURL := fmt.Sprintf("%s/tracks?limit=50", fmt.Sprintf(albumBaseURL, albumID))
	var items []trackSimplified
	batchDelay := time.Duration(0)
	if batch {
		batchDelay = delay
	}
	batches, err := fetchPaging(ctx, c, tracksURL, token, batchDelay, &items)
	if err != nil {
		return nil, err
	}
	if len(items) > 0 {
		data.Tracks.Items = items
	}

	return &albumRaw{
		Data:         data,
		Token:        token,
		BatchEnabled: batch,
		BatchCount:   batches,
	}, nil
}

func (c *SpotifyMetadataClient) fetchTrack(ctx context.Context, trackID, token string) (*trackFull, error) {
	var data trackFull
	if err := c.getJSON(ctx, fmt.Sprintf(trackBaseURL, trackID), token, &data); err != nil {
		return nil, err
	}
	return &data, nil
}

func (c *SpotifyMetadataClient) fetchArtistDiscography(ctx context.Context, parsed spotifyURI, token string, batch bool, delay time.Duration) (*discographyRaw, error) {
	var artistData artistResponse
	if err := c.getJSON(ctx, fmt.Sprintf(artistBaseURL, parsed.ID), token, &artistData); err != nil {
		return nil, err
	}

	includeGroups := parsed.DiscographyGroup
	if includeGroups == "" || includeGroups == "all" {
		includeGroups = "album,single,compilation"
	}

	albumsURL := fmt.Sprintf("%s?include_groups=%s&limit=50", fmt.Sprintf(artistAlbumsBaseURL, parsed.ID), includeGroups)
	var albums []albumSimplified
	batchDelay := time.Duration(0)
	if batch {
		batchDelay = delay
	}
	batches, err := fetchPaging(ctx, c, albumsURL, token, batchDelay, &albums)
	if err != nil {
		return nil, err
	}

	return &discographyRaw{
		Artist:       artistData,
		Albums:       albums,
		Token:        token,
		Discography:  parsed.DiscographyGroup,
		BatchEnabled: batch,
		BatchCount:   batches,
	}, nil
}

func (c *SpotifyMetadataClient) fetchArtist(ctx context.Context, artistID, token string) (*artistResponse, error) {
	var artistData artistResponse
	if err := c.getJSON(ctx, fmt.Sprintf(artistBaseURL, artistID), token, &artistData); err != nil {
		return nil, err
	}
	return &artistData, nil
}

func (c *SpotifyMetadataClient) formatPlaylistData(raw *playlistRaw) PlaylistResponsePayload {
	var info PlaylistInfoMetadata
	info.Tracks.Total = raw.Data.Tracks.Total
	info.Followers.Total = raw.Data.Followers.Total
	info.Owner.DisplayName = raw.Data.Owner.DisplayName
	info.Owner.Name = raw.Data.Name
	info.Owner.Images = firstImageURL(raw.Data.Images)
	if raw.BatchEnabled {
		info.Batch = strconv.Itoa(maxInt(1, raw.BatchCount))
	}

	tracks := make([]AlbumTrackMetadata, 0, len(raw.Data.Tracks.Items))
	for _, item := range raw.Data.Tracks.Items {
		if item.Track == nil {
			continue
		}
		var artistID, artistURL string
		if len(item.Track.Artists) > 0 {
			artistID = item.Track.Artists[0].ID
			artistURL = fmt.Sprintf("https://open.spotify.com/artist/%s", item.Track.Artists[0].ID)
		}
		artistsData := make([]ArtistSimple, 0, len(item.Track.Artists))
		for _, a := range item.Track.Artists {
			artistsData = append(artistsData, ArtistSimple{
				ID:          a.ID,
				Name:        a.Name,
				ExternalURL: fmt.Sprintf("https://open.spotify.com/artist/%s", a.ID),
			})
		}
		tracks = append(tracks, AlbumTrackMetadata{
			SpotifyID:   item.Track.ID,
			Artists:     joinArtists(item.Track.Artists),
			Name:        item.Track.Name,
			AlbumName:   item.Track.Album.Name,
			AlbumArtist: joinArtists(item.Track.Album.Artists),
			DurationMS:  item.Track.DurationMS,
			Images:      firstNonEmpty(firstImageURL(item.Track.Album.Images), info.Owner.Images),
			ReleaseDate: item.Track.Album.ReleaseDate,
			TrackNumber: item.Track.TrackNumber,
			TotalTracks: item.Track.Album.TotalTracks,
			DiscNumber:  item.Track.DiscNumber,
			ExternalURL: item.Track.ExternalURL.Spotify,
			ISRC:        item.Track.ExternalID.ISRC,
			AlbumID:     item.Track.Album.ID,
			AlbumURL:    item.Track.Album.ExternalURL.Spotify,
			ArtistID:    artistID,
			ArtistURL:   artistURL,
			ArtistsData: artistsData,
		})
	}

	return PlaylistResponsePayload{
		PlaylistInfo: info,
		TrackList:    tracks,
	}
}

func (c *SpotifyMetadataClient) formatAlbumData(ctx context.Context, raw *albumRaw) (*AlbumResponsePayload, error) {
	albumImage := firstImageURL(raw.Data.Images)
	var artistID, artistURL string
	if len(raw.Data.Artists) > 0 {
		artistID = raw.Data.Artists[0].ID
		artistURL = fmt.Sprintf("https://open.spotify.com/artist/%s", raw.Data.Artists[0].ID)
	}
	info := AlbumInfoMetadata{
		TotalTracks: raw.Data.TotalTracks,
		Name:        raw.Data.Name,
		ReleaseDate: raw.Data.ReleaseDate,
		Artists:     joinArtists(raw.Data.Artists),
		Images:      albumImage,
		ArtistID:    artistID,
		ArtistURL:   artistURL,
	}
	if raw.BatchEnabled {
		info.Batch = strconv.Itoa(maxInt(1, raw.BatchCount))
	}

	tracks := make([]AlbumTrackMetadata, 0, len(raw.Data.Tracks.Items))
	cache := make(map[string]string)
	for _, item := range raw.Data.Tracks.Items {
		isrc := c.fetchTrackISRC(ctx, item.ID, raw.Token, cache)
		tracks = append(tracks, AlbumTrackMetadata{
			SpotifyID:   item.ID,
			Artists:     joinArtists(item.Artists),
			Name:        item.Name,
			AlbumName:   raw.Data.Name,
			AlbumArtist: joinArtists(raw.Data.Artists),
			DurationMS:  item.DurationMS,
			Images:      albumImage,
			ReleaseDate: raw.Data.ReleaseDate,
			TrackNumber: item.TrackNumber,
			TotalTracks: raw.Data.TotalTracks,
			DiscNumber:  item.DiscNumber,
			ExternalURL: item.ExternalURL.Spotify,
			ISRC:        isrc,
		})
	}

	return &AlbumResponsePayload{
		AlbumInfo: info,
		TrackList: tracks,
	}, nil
}

func (c *SpotifyMetadataClient) formatArtistDiscographyData(ctx context.Context, raw *discographyRaw) (*ArtistDiscographyPayload, error) {
	artistImage := firstImageURL(raw.Artist.Images)
	discType := raw.Discography
	if discType == "" {
		discType = "all"
	}

	info := ArtistInfoMetadata{
		Name:            raw.Artist.Name,
		Followers:       raw.Artist.Followers.Total,
		Genres:          raw.Artist.Genres,
		Images:          artistImage,
		ExternalURL:     raw.Artist.ExternalURL.Spotify,
		DiscographyType: discType,
		TotalAlbums:     len(raw.Albums),
	}
	if raw.BatchEnabled {
		info.Batch = strconv.Itoa(maxInt(1, raw.BatchCount))
	}

	albumList := make([]DiscographyAlbumMetadata, 0, len(raw.Albums))
	allTracks := make([]AlbumTrackMetadata, 0)
	isrcCache := make(map[string]string)

	for _, alb := range raw.Albums {
		albumImage := firstImageURL(alb.Images)
		albumList = append(albumList, DiscographyAlbumMetadata{
			ID:          alb.ID,
			Name:        alb.Name,
			AlbumType:   alb.AlbumType,
			ReleaseDate: alb.ReleaseDate,
			TotalTracks: alb.TotalTracks,
			Artists:     joinArtists(alb.Artists),
			Images:      albumImage,
			ExternalURL: alb.ExternalURL.Spotify,
		})

		tracks, err := c.collectAlbumTracks(ctx, alb.ID, raw.Token)
		if err != nil {
			fmt.Printf("Error getting tracks for album %s: %v\n", alb.Name, err)
			continue
		}

		for _, tr := range tracks {
			isrc := c.fetchTrackISRC(ctx, tr.ID, raw.Token, isrcCache)
			var artistID, artistURL string
			if len(tr.Artists) > 0 {
				artistID = tr.Artists[0].ID
				artistURL = fmt.Sprintf("https://open.spotify.com/artist/%s", tr.Artists[0].ID)
			}
			artistsData := make([]ArtistSimple, 0, len(tr.Artists))
			for _, a := range tr.Artists {
				artistsData = append(artistsData, ArtistSimple{
					ID:          a.ID,
					Name:        a.Name,
					ExternalURL: fmt.Sprintf("https://open.spotify.com/artist/%s", a.ID),
				})
			}
			allTracks = append(allTracks, AlbumTrackMetadata{
				SpotifyID:   tr.ID,
				Artists:     joinArtists(tr.Artists),
				Name:        tr.Name,
				AlbumName:   alb.Name,
				AlbumArtist: joinArtists(alb.Artists),
				AlbumType:   alb.AlbumType,
				DurationMS:  tr.DurationMS,
				Images:      albumImage,
				ReleaseDate: alb.ReleaseDate,
				TrackNumber: tr.TrackNumber,
				TotalTracks: alb.TotalTracks,
				DiscNumber:  tr.DiscNumber,
				ExternalURL: tr.ExternalURL.Spotify,
				ISRC:        isrc,
				AlbumID:     alb.ID,
				AlbumURL:    alb.ExternalURL.Spotify,
				ArtistID:    artistID,
				ArtistURL:   artistURL,
				ArtistsData: artistsData,
			})
		}
	}

	return &ArtistDiscographyPayload{
		ArtistInfo: info,
		AlbumList:  albumList,
		TrackList:  allTracks,
	}, nil
}

func formatArtistData(raw *artistResponse) ArtistResponsePayload {
	if raw == nil {
		return ArtistResponsePayload{}
	}
	payload := ArtistResponsePayload{}
	payload.Artist.Name = raw.Name
	payload.Artist.Followers = raw.Followers.Total
	payload.Artist.Genres = raw.Genres
	payload.Artist.Images = firstImageURL(raw.Images)
	payload.Artist.ExternalURL = raw.ExternalURL.Spotify
	payload.Artist.Popularity = raw.Popularity
	return payload
}

func formatTrackData(raw *trackFull) TrackResponse {
	if raw == nil {
		return TrackResponse{}
	}
	return TrackResponse{
		Track: TrackMetadata{
			SpotifyID:   raw.ID,
			Artists:     joinArtists(raw.Artists),
			Name:        raw.Name,
			AlbumName:   raw.Album.Name,
			AlbumArtist: joinArtists(raw.Album.Artists),
			DurationMS:  raw.DurationMS,
			Images:      firstImageURL(raw.Album.Images),
			ReleaseDate: raw.Album.ReleaseDate,
			TrackNumber: raw.TrackNumber,
			TotalTracks: raw.Album.TotalTracks,
			DiscNumber:  raw.DiscNumber,
			ExternalURL: raw.ExternalURL.Spotify,
			ISRC:        raw.ExternalID.ISRC,
		},
	}
}

func (c *SpotifyMetadataClient) collectAlbumTracks(ctx context.Context, albumID, token string) ([]trackSimplified, error) {
	url := fmt.Sprintf("%s/tracks?limit=50", fmt.Sprintf(albumBaseURL, albumID))
	var tracks []trackSimplified
	_, err := fetchPaging(ctx, c, url, token, 0, &tracks)
	if err != nil {
		return nil, err
	}
	return tracks, nil
}

func (c *SpotifyMetadataClient) fetchTrackISRC(ctx context.Context, trackID, token string, cache map[string]string) string {
	if trackID == "" || token == "" {
		return ""
	}
	if isrc, ok := cache[trackID]; ok {
		return isrc
	}

	var data struct {
		ExternalID externalID `json:"external_ids"`
	}
	if err := c.getJSON(ctx, fmt.Sprintf(trackBaseURL, trackID), token, &data); err != nil {
		return ""
	}
	cache[trackID] = data.ExternalID.ISRC
	return cache[trackID]
}

func fetchPaging[T any](ctx context.Context, client *SpotifyMetadataClient, nextURL, token string, delay time.Duration, dest *[]T) (int, error) {
	batches := 0
	for nextURL != "" {
		select {
		case <-ctx.Done():
			return batches, ctx.Err()
		default:
		}

		var page struct {
			Items []T    `json:"items"`
			Next  string `json:"next"`
		}
		if err := client.getJSON(ctx, nextURL, token, &page); err != nil {
			return batches, err
		}

		*dest = append(*dest, page.Items...)
		nextURL = stripLocaleParam(page.Next)
		batches++

		if nextURL != "" && delay > 0 {
			if err := sleepWithContext(ctx, delay); err != nil {
				return batches, err
			}
		}
	}
	return batches, nil
}

func (c *SpotifyMetadataClient) getJSON(ctx context.Context, endpoint, token string, dst interface{}) error {
	body, err := c.getOrFetchBody(ctx, endpoint, token)
	if err != nil {
		return err
	}
	return json.Unmarshal(body, dst)
}

func (c *SpotifyMetadataClient) fetchJSONBody(ctx context.Context, endpoint, token string) ([]byte, error) {
	spotifyDebugf("api GET %s", endpoint)
	host := c.getHostFromURL(endpoint)
	if err := c.enforceRateLimitGate(ctx, host); err != nil {
		return nil, err
	}
	maxWait := spotifyMaxWaitFromContext(ctx)
	var rateLimitCount int
	for attempt := 0; attempt < 6; attempt++ {
		start := time.Now()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, err
		}
		headers := c.baseHeaders()
		for key, values := range headers {
			for _, v := range values {
				req.Header.Add(key, v)
			}
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}

		resp, err := c.httpClient.Do(req)
		if err != nil {
			spotifyDebugf("api request error (attempt=%d elapsed=%s): %v", attempt+1, time.Since(start), err)
			// Retry transient network errors a few times.
			if attempt < 2 && isRetriableHTTPError(err) {
				_ = sleepWithContext(ctx, time.Duration(attempt+1)*250*time.Millisecond)
				continue
			}
			return nil, err
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, err
		}
		spotifyDebugf("api response status=%d elapsed=%s", resp.StatusCode, time.Since(start))

		if resp.StatusCode == http.StatusTooManyRequests {
			rateLimitCount++
			retryAfter := parseRetryAfter(resp.Header.Get("Retry-After"))
			until, backoff := c.noteRateLimited(host, retryAfter)
			sleepFor := time.Until(until)
			spotifyDebugf("api 429 rate-limited retry-after=%s", retryAfter)

			// Smooth path: if we have enough timeout budget, wait through the full cooldown and retry.
			if maxWait > 0 && sleepFor > 0 && sleepFor <= maxWait && rateLimitCount <= 2 {
				if err := sleepWithContext(ctx, sleepFor); err != nil {
					return nil, err
				}
				continue
			}

			preview := spotifyPreviewBody(body, 350)
			if preview != "" {
				return nil, fmt.Errorf("spotify API rate limited (429) endpoint=%s retry-after=%s cooldown-until=%s backoff=%s body=%q", endpoint, retryAfter, until.Format(time.RFC3339), backoff.Round(time.Second), preview)
			}
			return nil, fmt.Errorf("spotify API rate limited (429) endpoint=%s retry-after=%s cooldown-until=%s backoff=%s", endpoint, retryAfter, until.Format(time.RFC3339), backoff.Round(time.Second))
		}

		if resp.StatusCode == http.StatusUnauthorized {
			// Token likely expired/revoked; clear cache so next attempt fetches a new token.
			if token != "" {
				c.clearTokenCache()
			}
			preview := spotifyPreviewBody(body, 350)
			if preview != "" {
				return nil, fmt.Errorf("spotify API unauthorized (401) endpoint=%s body=%q", endpoint, preview)
			}
			return nil, fmt.Errorf("spotify API unauthorized (401) endpoint=%s", endpoint)
		}

		if resp.StatusCode == http.StatusBadGateway || resp.StatusCode == http.StatusServiceUnavailable || resp.StatusCode == http.StatusGatewayTimeout {
			// Transient upstream errors.
			if attempt < 2 {
				_ = sleepWithContext(ctx, time.Duration(attempt+1)*350*time.Millisecond)
				continue
			}
		}

		if resp.StatusCode != http.StatusOK {
			preview := spotifyPreviewBody(body, 900)
			spotifyDebugf("api non-200 status=%d endpoint=%s body(peek)=%s", resp.StatusCode, endpoint, preview)
			if preview != "" {
				return nil, fmt.Errorf("spotify API returned status %d for %s body=%q", resp.StatusCode, endpoint, preview)
			}
			return nil, fmt.Errorf("spotify API returned status %d for %s", resp.StatusCode, endpoint)
		}

		return body, nil
	}

	return nil, fmt.Errorf("spotify API failed after retries for %s", endpoint)
}

func (c *SpotifyMetadataClient) baseHeaders() http.Header {
	h := http.Header{}
	h.Set("User-Agent", c.userAgent)
	h.Set("Accept", "application/json")
	h.Set("Accept-Language", "en-US,en;q=0.9")
	h.Set("sec-ch-ua-platform", "\"Windows\"")
	h.Set("sec-fetch-dest", "empty")
	h.Set("sec-fetch-mode", "cors")
	h.Set("sec-fetch-site", "same-origin")
	h.Set("Referer", "https://open.spotify.com/")
	h.Set("Origin", "https://open.spotify.com")
	return h
}

func (c *SpotifyMetadataClient) randomUserAgent() string {
	c.rngMu.Lock()
	defer c.rngMu.Unlock()

	macMajor := c.randRange(11, 15)
	macMinor := c.randRange(4, 9)
	webkitMajor := c.randRange(530, 537)
	webkitMinor := c.randRange(30, 37)
	chromeMajor := c.randRange(80, 105)
	chromeBuild := c.randRange(3000, 4500)
	chromePatch := c.randRange(60, 125)
	safariMajor := c.randRange(530, 537)
	safariMinor := c.randRange(30, 36)

	return fmt.Sprintf(
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_%d_%d) AppleWebKit/%d.%d (KHTML, like Gecko) Chrome/%d.0.%d.%d Safari/%d.%d",
		macMajor,
		macMinor,
		webkitMajor,
		webkitMinor,
		chromeMajor,
		chromeBuild,
		chromePatch,
		safariMajor,
		safariMinor,
	)
}

func (c *SpotifyMetadataClient) randRange(min, max int) int {
	if max <= min {
		return min
	}
	return c.rng.Intn(max-min) + min
}

func (c *SpotifyMetadataClient) getAccessTokenTOTP(ctx context.Context) (string, error) {
	code, serverTime, version, err := c.generateTOTP(ctx)
	if err != nil {
		return "", err
	}

	timestampMS := time.Now().UnixMilli()
	params := url.Values{}
	params.Set("reason", "init")
	params.Set("productType", "web-player")
	params.Set("totp", code)
	params.Set("totpServerTime", strconv.FormatInt(serverTime, 10))
	params.Set("totpVer", strconv.Itoa(version))
	params.Set("sTime", strconv.FormatInt(serverTime, 10))
	params.Set("cTime", strconv.FormatInt(timestampMS, 10))
	// These values are intentionally omitted; Spotify frequently changes them.

	requestURL := spotifyTokenURL + "?" + params.Encode()
	return c.fetchAccessTokenWithRetryURL(ctx, requestURL)
}

func (c *SpotifyMetadataClient) getAccessToken(ctx context.Context) (string, error) {
	// Preferred: official OAuth token (user login via Settings).
	if oauthToken, ok, err := GetSpotifyOAuthAccessToken(ctx); err != nil {
		spotifyDebugf("oauth token fetch failed: %v", err)
	} else if ok && oauthToken != "" {
		spotifyDebugf("using spotify oauth access token")
		return oauthToken, nil
	}

	if token, ok := c.getCachedToken(); ok {
		spotifyDebugf("using cached access token")
		return token, nil
	}

	// Original logic order: TOTP -> legacy -> access point.
	token, err := c.getAccessTokenTOTP(ctx)
	if err == nil && token != "" {
		// getAccessTokenTOTP ultimately calls fetchAccessTokenWithRetryURL which caches expiry.
		if cached, ok := c.getCachedToken(); ok {
			return cached, nil
		}
		return token, nil
	}
	totpErr := err

	token, err = c.getAccessTokenLegacy(ctx)
	if err == nil && token != "" {
		if cached, ok := c.getCachedToken(); ok {
			return cached, nil
		}
		return token, nil
	}
	legacyErr := err

	token, err = c.getAccessTokenAccessPoint(ctx)
	if err == nil && token != "" {
		if cached, ok := c.getCachedToken(); ok {
			return cached, nil
		}
		return token, nil
	}
	accessPointErr := err

	spotifyDebugf("getAccessToken totp failed: %v", totpErr)
	spotifyDebugf("getAccessToken legacy failed: %v", legacyErr)
	spotifyDebugf("getAccessToken accessPoint failed: %v", accessPointErr)

	return "", fmt.Errorf("failed to get Spotify access token: totp=%v; legacy=%v; accessPoint=%v", totpErr, legacyErr, accessPointErr)
}

func (c *SpotifyMetadataClient) getAccessTokenLegacy(ctx context.Context) (string, error) {
	params := url.Values{}
	params.Set("reason", "transport")
	params.Set("productType", "web_player")
	requestURL := spotifyLegacyTokenURL + "?" + params.Encode()
	return c.fetchAccessTokenWithRetryURL(ctx, requestURL)
}

func (c *SpotifyMetadataClient) getAccessTokenAccessPoint(ctx context.Context) (string, error) {
	return c.fetchAccessTokenWithRetryURL(ctx, spotifyAccessPointURL)
}

func (c *SpotifyMetadataClient) fetchAccessTokenWithRetryURL(ctx context.Context, requestURL string) (string, error) {
	spotifyDebugf("token GET %s", redactSpotifyTokenURL(requestURL))
	host := c.getHostFromURL(requestURL)
	if err := c.enforceRateLimitGate(ctx, host); err != nil {
		return "", err
	}

	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		spotifyDebugf("token attempt=%d", attempt+1)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
		if err != nil {
			return "", err
		}
		req.Header = c.baseHeaders()

		resp, err := c.httpClient.Do(req)
		if err != nil {
			lastErr = err
			_ = sleepWithContext(ctx, time.Duration(attempt+1)*250*time.Millisecond)
			continue
		}
		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			lastErr = readErr
			_ = sleepWithContext(ctx, time.Duration(attempt+1)*250*time.Millisecond)
			continue
		}

		if resp.StatusCode == http.StatusTooManyRequests {
			retryAfter := parseRetryAfter(resp.Header.Get("Retry-After"))
			until, backoff := c.noteRateLimited(host, retryAfter)
			spotifyDebugf("token 429 rate-limited retry-after=%s", retryAfter)
			lastErr = fmt.Errorf("rate limited while getting token: retry-after=%s cooldown-until=%s backoff=%s", retryAfter, until.Format(time.RFC3339), backoff.Round(time.Second))
			// If the wait is short, retry; otherwise surface immediately so UI stays responsive.
			if retryAfter <= 10*time.Second {
				_ = sleepWithContext(ctx, retryAfter)
				continue
			}
			continue
		}

		if resp.StatusCode != http.StatusOK {
			preview := string(body)
			if len(preview) > 500 {
				preview = preview[:500]
			}
			spotifyDebugf("token non-200 status=%d body(peek)=%s", resp.StatusCode, spotifyPreviewBody(body, 500))
			lastErr = fmt.Errorf("token request failed. status=%d body=%q", resp.StatusCode, preview)
			if resp.StatusCode >= 500 {
				_ = sleepWithContext(ctx, time.Duration(attempt+1)*500*time.Millisecond)
				continue
			}
			break
		}

		var token accessTokenResponse
		if err := json.Unmarshal(body, &token); err != nil {
			return "", err
		}
		if token.AccessToken == "" {
			return "", errors.New("failed to get access token: empty token received")
		}
		until := spotifyTokenExpiryFromPayload(token)
		// Small safety buffer to reduce 401s at expiry edge.
		if until.After(time.Now().Add(30 * time.Second)) {
			until = until.Add(-30 * time.Second)
		}
		c.cacheToken(token.AccessToken, until)
		return token.AccessToken, nil
	}
	if lastErr == nil {
		lastErr = errors.New("failed to get access token")
	}
	return "", lastErr
}

func (c *SpotifyMetadataClient) generateTOTP(ctx context.Context) (string, int64, int, error) {
	secrets, _, err := c.fetchSecretBytes(ctx)
	if err != nil {
		return "", 0, 0, err
	}
	if len(secrets) == 0 {
		return "", 0, 0, errors.New("no secrets available")
	}

	latest := secrets[0]
	for _, entry := range secrets[1:] {
		if entry.Version > latest.Version {
			latest = entry
		}
	}

	builder := strings.Builder{}
	for idx, val := range latest.Secret {
		processed := val ^ ((idx % 33) + 9)
		builder.WriteString(strconv.Itoa(processed))
	}

	utfBytes := []byte(builder.String())
	hexStr := hex.EncodeToString(utfBytes)
	secretBytes, err := hex.DecodeString(hexStr)
	if err != nil {
		return "", 0, 0, err
	}
	b32Secret := base32.StdEncoding.EncodeToString(secretBytes)

	serverTime, err := c.getServerTimeCached(ctx)
	if err != nil {
		return "", 0, 0, err
	}

	code, err := computeTOTP(b32Secret, serverTime)
	if err != nil {
		return "", 0, 0, err
	}

	return code, serverTime, latest.Version, nil
}

func (c *SpotifyMetadataClient) fetchSecretBytes(ctx context.Context) ([]secretEntry, bool, error) {
	// In-memory cache to avoid repeated remote fetches (reduces rate limiting / instability).
	c.secretsMu.Lock()
	if len(c.cachedSecrets) > 0 && !c.cachedSecretsAt.IsZero() && time.Since(c.cachedSecretsAt) <= c.cachedSecretsTTL {
		secrets := make([]secretEntry, len(c.cachedSecrets))
		copy(secrets, c.cachedSecrets)
		c.secretsMu.Unlock()
		return secrets, false, nil
	}
	c.secretsMu.Unlock()

	urlWithCacheBust := secretBytesRemotePath
	host := c.getHostFromURL(urlWithCacheBust)
	if err := c.enforceRateLimitGate(ctx, host); err != nil {
		return nil, false, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlWithCacheBust, nil)
	if err == nil {
		// Normal headers; allow CDN caching. We cache in-memory anyway.
		req.Header.Set("Accept", "application/json")

		resp, err := c.httpClient.Do(req)
		if err == nil {
			body, readErr := io.ReadAll(resp.Body)
			resp.Body.Close()
			if readErr == nil && resp.StatusCode == http.StatusTooManyRequests {
				retryAfter := parseRetryAfter(resp.Header.Get("Retry-After"))
				_, _ = c.noteRateLimited(host, retryAfter)
			}
			if readErr == nil && resp.StatusCode == http.StatusOK {
				var secrets []secretEntry
				if jsonErr := json.Unmarshal(body, &secrets); jsonErr == nil {
					c.secretsMu.Lock()
					c.cachedSecrets = secrets
					c.cachedSecretsAt = time.Now()
					c.secretsMu.Unlock()

					// Best-effort write-through cache for offline stability.
					home, herr := os.UserHomeDir()
					if herr == nil {
						localDir := filepath.Join(home, ".spotify-secret")
						_ = os.MkdirAll(localDir, 0o755)
						_ = os.WriteFile(filepath.Join(localDir, "secretBytes.json"), body, 0o644)
					}
					return secrets, false, nil
				}
			}
		}
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return nil, false, fmt.Errorf("GitHub fetch failed and could not resolve home directory: %w", err)
	}
	localPath := filepath.Join(home, ".spotify-secret", "secretBytes.json")
	data, err := os.ReadFile(localPath)
	if err != nil {
		return nil, false, fmt.Errorf("failed to fetch secrets from both GitHub and local: %w", err)
	}

	var secrets []secretEntry
	if err := json.Unmarshal(data, &secrets); err != nil {
		return nil, false, fmt.Errorf("failed to process local secrets: %w", err)
	}

	c.secretsMu.Lock()
	c.cachedSecrets = secrets
	c.cachedSecretsAt = time.Now()
	c.secretsMu.Unlock()

	return secrets, true, nil
}

func (c *SpotifyMetadataClient) fetchServerTime(ctx context.Context) (int64, error) {
	endpoint := "https://open.spotify.com/api/server-time"
	host := c.getHostFromURL(endpoint)
	if err := c.enforceRateLimitGate(ctx, host); err != nil {
		return 0, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return 0, err
	}
	req.Header = c.serverTimeHeaders()

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		return 0, err
	}

	if resp.StatusCode == http.StatusTooManyRequests {
		retryAfter := parseRetryAfter(resp.Header.Get("Retry-After"))
		until, backoff := c.noteRateLimited(host, retryAfter)
		return 0, fmt.Errorf("spotify server-time rate limited (429) retry-after=%s cooldown-until=%s backoff=%s", retryAfter, until.Format(time.RFC3339), backoff.Round(time.Second))
	}
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("failed to get server time. Status code: %d", resp.StatusCode)
	}

	var payload serverTimeResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return 0, err
	}
	if payload.ServerTime == 0 {
		return 0, errors.New("failed to fetch server time from Spotify")
	}
	return payload.ServerTime, nil
}

func (c *SpotifyMetadataClient) serverTimeHeaders() http.Header {
	h := http.Header{}
	h.Set("Host", "open.spotify.com")
	h.Set("User-Agent", c.randomUserAgent())
	h.Set("Accept", "*/*")
	return h
}

func computeTOTP(b32Secret string, timestamp int64) (string, error) {
	normalized := strings.ToUpper(strings.ReplaceAll(b32Secret, " ", ""))
	key, err := base32.StdEncoding.DecodeString(normalized)
	if err != nil {
		return "", err
	}

	// Normalise milliseconds if necessary.
	if timestamp > 1_000_000_000_000 {
		timestamp /= 1000
	}

	counter := uint64(timestamp / 30)
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], counter)

	mac := hmac.New(sha1.New, key)
	if _, err := mac.Write(buf[:]); err != nil {
		return "", err
	}
	sum := mac.Sum(nil)
	if len(sum) < 20 {
		return "", errors.New("unexpected hmac length for TOTP")
	}

	offset := sum[len(sum)-1] & 0x0f
	binaryCode := (int(sum[offset])&0x7f)<<24 |
		(int(sum[offset+1])&0xff)<<16 |
		(int(sum[offset+2])&0xff)<<8 |
		(int(sum[offset+3]) & 0xff)
	otp := binaryCode % 1_000_000
	return fmt.Sprintf("%06d", otp), nil
}

func isRetriableHTTPError(err error) bool {
	if err == nil {
		return false
	}
	// net.Error provides Timeout/Temporary checks
	if ne, ok := err.(interface{ Timeout() bool }); ok && ne.Timeout() {
		return true
	}
	if ne, ok := err.(interface{ Temporary() bool }); ok && ne.Temporary() {
		return true
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "connection reset") || strings.Contains(msg, "connection refused") || strings.Contains(msg, "broken pipe") {
		return true
	}
	return false
}

func parseSpotifyURI(input string) (spotifyURI, error) {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return spotifyURI{}, errInvalidSpotifyURL
	}

	if strings.HasPrefix(trimmed, "spotify:") {
		parts := strings.Split(trimmed, ":")
		if len(parts) == 3 {
			switch parts[1] {
			case "album", "track", "playlist", "artist":
				return spotifyURI{Type: parts[1], ID: parts[2]}, nil
			}
		}
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return spotifyURI{}, err
	}

	if parsed.Host == "embed.spotify.com" {
		if parsed.RawQuery == "" {
			return spotifyURI{}, errInvalidSpotifyURL
		}
		qs, _ := url.ParseQuery(parsed.RawQuery)
		embedded := qs.Get("uri")
		if embedded == "" {
			return spotifyURI{}, errInvalidSpotifyURL
		}
		return parseSpotifyURI(embedded)
	}

	if parsed.Scheme == "" && parsed.Host == "" {
		id := strings.Trim(strings.TrimSpace(parsed.Path), "/")
		if id == "" {
			return spotifyURI{}, errInvalidSpotifyURL
		}
		return spotifyURI{Type: "playlist", ID: id}, nil
	}

	if parsed.Host != "open.spotify.com" && parsed.Host != "play.spotify.com" {
		return spotifyURI{}, errInvalidSpotifyURL
	}

	parts := cleanPathParts(parsed.Path)
	if len(parts) == 0 {
		return spotifyURI{}, errInvalidSpotifyURL
	}

	if parts[0] == "embed" {
		parts = parts[1:]
	}
	if len(parts) == 0 {
		return spotifyURI{}, errInvalidSpotifyURL
	}
	if strings.HasPrefix(parts[0], "intl-") {
		parts = parts[1:]
	}
	if len(parts) == 0 {
		return spotifyURI{}, errInvalidSpotifyURL
	}

	if len(parts) == 2 {
		switch parts[0] {
		case "album", "track", "playlist", "artist":
			return spotifyURI{Type: parts[0], ID: parts[1]}, nil
		}
	}

	if len(parts) == 4 && parts[2] == "playlist" {
		return spotifyURI{Type: "playlist", ID: parts[3]}, nil
	}

	if len(parts) >= 3 && parts[0] == "artist" {
		if len(parts) >= 3 && parts[2] == "discography" {
			discType := "all"
			if len(parts) >= 4 {
				candidate := parts[3]
				if candidate == "all" || candidate == "album" || candidate == "single" || candidate == "compilation" {
					discType = candidate
				}
			}
			return spotifyURI{Type: "artist_discography", ID: parts[1], DiscographyGroup: discType}, nil
		}
		return spotifyURI{Type: "artist", ID: parts[1]}, nil
	}

	return spotifyURI{}, errInvalidSpotifyURL
}

func cleanPathParts(path string) []string {
	raw := strings.Split(path, "/")
	parts := make([]string, 0, len(raw))
	for _, part := range raw {
		if part != "" {
			parts = append(parts, part)
		}
	}
	return parts
}

func stripLocaleParam(raw string) string {
	if raw == "" {
		return ""
	}
	if idx := strings.Index(raw, "&locale="); idx != -1 {
		return raw[:idx]
	}
	if idx := strings.Index(raw, "?locale="); idx != -1 {
		return raw[:idx]
	}
	return raw
}

func firstImageURL(images []image) string {
	if len(images) == 0 {
		return ""
	}
	return images[0].URL
}

func joinArtists(artists []artist) string {
	if len(artists) == 0 {
		return ""
	}
	names := make([]string, 0, len(artists))
	for _, a := range artists {
		if a.Name != "" {
			names = append(names, a.Name)
		}
	}
	return strings.Join(names, ", ")
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func parseRetryAfter(value string) time.Duration {
	if value == "" {
		return 5 * time.Second
	}
	secs, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return 5 * time.Second
	}
	return time.Duration(secs+1) * time.Second
}

func sleepWithContext(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

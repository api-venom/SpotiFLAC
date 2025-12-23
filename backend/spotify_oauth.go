package backend

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
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

type SpotifyOAuthStatus struct {
	Enabled     bool      `json:"enabled"`
	Pending     bool      `json:"pending"`
	ExpiresAt   time.Time `json:"expires_at,omitempty"`
	HasRefresh  bool      `json:"has_refresh"`
	ClientID    string    `json:"client_id,omitempty"`
	LastError   string    `json:"last_error,omitempty"`
	CooldownMsg string    `json:"cooldown_msg,omitempty"`
}

type spotifyOAuthTokens struct {
	ClientID      string    `json:"client_id"`
	AccessToken   string    `json:"access_token"`
	RefreshToken  string    `json:"refresh_token,omitempty"`
	ExpiresAt     time.Time `json:"expires_at"`
	TokenType     string    `json:"token_type,omitempty"`
	Scope         string    `json:"scope,omitempty"`
	LastUpdatedAt time.Time `json:"last_updated_at"`
}

type spotifyTokenExchangeResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	Scope        string `json:"scope"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
}

type spotifyTokenRefreshResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	Scope       string `json:"scope"`
	ExpiresIn   int    `json:"expires_in"`
}

type spotifyOAuthPending struct {
	clientID     string
	codeVerifier string
	state        string
	redirectURI  string
	server       *http.Server
	listener     net.Listener
	done         chan struct{}
	lastError    string
}

var (
	spotifyOAuthMu      sync.Mutex
	spotifyOAuthPendingState *spotifyOAuthPending
)

func getSpotiFlacDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".spotiflac"), nil
}

func getSpotifyOAuthTokenPath() (string, error) {
	dir, err := getSpotiFlacDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "spotify_oauth.json"), nil
}

func loadSpotifyOAuthTokens() (*spotifyOAuthTokens, error) {
	path, err := getSpotifyOAuthTokenPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var t spotifyOAuthTokens
	if err := json.Unmarshal(data, &t); err != nil {
		return nil, err
	}
	if strings.TrimSpace(t.AccessToken) == "" {
		return nil, errors.New("spotify oauth token file missing access_token")
	}
	return &t, nil
}

func saveSpotifyOAuthTokens(tokens *spotifyOAuthTokens) error {
	if tokens == nil {
		return errors.New("nil tokens")
	}
	path, err := getSpotifyOAuthTokenPath()
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(tokens, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, payload, 0o600)
}

func ClearSpotifyOAuthTokens() error {
	spotifyOAuthMu.Lock()
	if spotifyOAuthPendingState != nil {
		spotifyOAuthPendingState.lastError = "cancelled"
		if spotifyOAuthPendingState.server != nil {
			_ = spotifyOAuthPendingState.server.Close()
		}
		if spotifyOAuthPendingState.listener != nil {
			_ = spotifyOAuthPendingState.listener.Close()
		}
		select {
		case <-spotifyOAuthPendingState.done:
		default:
			close(spotifyOAuthPendingState.done)
		}
		spotifyOAuthPendingState = nil
	}
	spotifyOAuthMu.Unlock()

	path, err := getSpotifyOAuthTokenPath()
	if err != nil {
		return err
	}
	_ = os.Remove(path)
	return nil
}

func GetSpotifyOAuthStatus() SpotifyOAuthStatus {
	spotifyOAuthMu.Lock()
	pending := spotifyOAuthPendingState != nil
	lastErr := ""
	if spotifyOAuthPendingState != nil {
		lastErr = spotifyOAuthPendingState.lastError
	}
	spotifyOAuthMu.Unlock()

	status := SpotifyOAuthStatus{Pending: pending, LastError: lastErr}
	if tokens, err := loadSpotifyOAuthTokens(); err == nil && tokens != nil {
		status.Enabled = true
		status.ExpiresAt = tokens.ExpiresAt
		status.HasRefresh = strings.TrimSpace(tokens.RefreshToken) != ""
		status.ClientID = tokens.ClientID
	}
	return status
}

func BeginSpotifyOAuthLogin(ctx context.Context, clientID string) (string, error) {
	clientID = strings.TrimSpace(clientID)
	if clientID == "" {
		return "", errors.New("spotify client id is required")
	}

	spotifyOAuthMu.Lock()
	if spotifyOAuthPendingState != nil {
		// Return existing auth url if already pending.
		url := buildSpotifyAuthorizeURL(spotifyOAuthPendingState.clientID, spotifyOAuthPendingState.redirectURI, spotifyOAuthPendingState.state, spotifyOAuthPendingState.codeVerifier)
		spotifyOAuthMu.Unlock()
		return url, nil
	}
	spotifyOAuthMu.Unlock()

	verifier, err := randomURLSafeString(64)
	if err != nil {
		return "", err
	}
	state, err := randomURLSafeString(32)
	if err != nil {
		return "", err
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", err
	}

	port := ln.Addr().(*net.TCPAddr).Port
	redirectURI := fmt.Sprintf("http://127.0.0.1:%d/callback", port)

	pending := &spotifyOAuthPending{
		clientID:     clientID,
		codeVerifier: verifier,
		state:        state,
		redirectURI:  redirectURI,
		listener:     ln,
		done:         make(chan struct{}),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("error") != "" {
			pending.lastError = q.Get("error")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte("Spotify login failed. You can close this window."))
			select {
			case <-pending.done:
			default:
				close(pending.done)
			}
			return
		}
		if q.Get("state") != pending.state {
			pending.lastError = "state mismatch"
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte("Spotify login failed (state mismatch). You can close this window."))
			select {
			case <-pending.done:
			default:
				close(pending.done)
			}
			return
		}
		code := q.Get("code")
		if code == "" {
			pending.lastError = "missing code"
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte("Spotify login failed (missing code). You can close this window."))
			select {
			case <-pending.done:
			default:
				close(pending.done)
			}
			return
		}

		tokens, exchErr := exchangeSpotifyAuthCode(r.Context(), clientID, code, redirectURI, verifier)
		if exchErr != nil {
			pending.lastError = exchErr.Error()
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte("Spotify login failed (token exchange). You can close this window."))
			select {
			case <-pending.done:
			default:
				close(pending.done)
			}
			return
		}

		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("Spotify login complete. You can close this window and return to SpotiFLAC."))

		tokens.ClientID = clientID
		tokens.LastUpdatedAt = time.Now()
		if err := saveSpotifyOAuthTokens(tokens); err != nil {
			pending.lastError = err.Error()
		}

		select {
		case <-pending.done:
		default:
			close(pending.done)
		}
		// Stop server after callback.
		go func() {
			_ = pending.server.Close()
		}()
	})

	srv := &http.Server{Handler: mux}
	pending.server = srv

	spotifyOAuthMu.Lock()
	spotifyOAuthPendingState = pending
	spotifyOAuthMu.Unlock()

	go func() {
		_ = srv.Serve(ln)
		spotifyOAuthMu.Lock()
		// If login completes or server stops, clear pending.
		if spotifyOAuthPendingState == pending {
			spotifyOAuthPendingState = nil
		}
		spotifyOAuthMu.Unlock()
	}()

	authURL := buildSpotifyAuthorizeURL(clientID, redirectURI, state, verifier)
	return authURL, nil
}

func buildSpotifyAuthorizeURL(clientID, redirectURI, state, codeVerifier string) string {
	challenge := pkceChallengeS256(codeVerifier)
	q := url.Values{}
	q.Set("response_type", "code")
	q.Set("client_id", clientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("state", state)
	q.Set("code_challenge_method", "S256")
	q.Set("code_challenge", challenge)
	// No scopes required for public metadata; keep minimal.
	return "https://accounts.spotify.com/authorize?" + q.Encode()
}

func pkceChallengeS256(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func randomURLSafeString(nBytes int) (string, error) {
	b := make([]byte, nBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func exchangeSpotifyAuthCode(ctx context.Context, clientID, code, redirectURI, codeVerifier string) (*spotifyOAuthTokens, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("client_id", clientID)
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)
	form.Set("code_verifier", codeVerifier)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://accounts.spotify.com/api/token", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		peek := string(body)
		if len(peek) > 600 {
			peek = peek[:600]
		}
		return nil, fmt.Errorf("spotify token exchange failed status=%d body=%q", resp.StatusCode, peek)
	}
	var out spotifyTokenExchangeResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	if strings.TrimSpace(out.AccessToken) == "" {
		return nil, errors.New("spotify token exchange returned empty access token")
	}
	// ExpiresIn is seconds.
	expiresAt := time.Now().Add(time.Duration(out.ExpiresIn) * time.Second)
	return &spotifyOAuthTokens{
		AccessToken:  out.AccessToken,
		RefreshToken: out.RefreshToken,
		ExpiresAt:    expiresAt,
		TokenType:    out.TokenType,
		Scope:        out.Scope,
		LastUpdatedAt: time.Now(),
		ClientID:     clientID,
	}, nil
}

func refreshSpotifyAccessToken(ctx context.Context, clientID, refreshToken string) (*spotifyOAuthTokens, error) {
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("client_id", clientID)
	form.Set("refresh_token", refreshToken)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://accounts.spotify.com/api/token", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		peek := string(body)
		if len(peek) > 600 {
			peek = peek[:600]
		}
		return nil, fmt.Errorf("spotify token refresh failed status=%d body=%q", resp.StatusCode, peek)
	}
	var out spotifyTokenRefreshResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	if strings.TrimSpace(out.AccessToken) == "" {
		return nil, errors.New("spotify token refresh returned empty access token")
	}
	expiresAt := time.Now().Add(time.Duration(out.ExpiresIn) * time.Second)
	return &spotifyOAuthTokens{
		ClientID:      clientID,
		AccessToken:   out.AccessToken,
		RefreshToken:  refreshToken,
		ExpiresAt:     expiresAt,
		TokenType:     out.TokenType,
		Scope:         out.Scope,
		LastUpdatedAt: time.Now(),
	}, nil
}

// GetSpotifyOAuthAccessToken returns a valid OAuth access token if configured.
// It will refresh using the refresh token if needed.
func GetSpotifyOAuthAccessToken(ctx context.Context) (string, bool, error) {
	tokens, err := loadSpotifyOAuthTokens()
	if err != nil {
		return "", false, nil
	}
	if tokens == nil {
		return "", false, nil
	}
	// If not close to expiry, use current.
	if time.Until(tokens.ExpiresAt) > 30*time.Second {
		return tokens.AccessToken, true, nil
	}
	if strings.TrimSpace(tokens.RefreshToken) == "" || strings.TrimSpace(tokens.ClientID) == "" {
		// No refresh possible.
		return tokens.AccessToken, true, nil
	}

	refreshed, err := refreshSpotifyAccessToken(ctx, tokens.ClientID, tokens.RefreshToken)
	if err != nil {
		return "", false, err
	}
	_ = saveSpotifyOAuthTokens(refreshed)
	return refreshed.AccessToken, true, nil
}

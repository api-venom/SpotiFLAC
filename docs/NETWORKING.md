# Networking ("curl" / "fetch")

This project does not shell out to `curl`. The "curl/fetch" work happens via:

- **Go backend**: `net/http` (`http.Client`, `http.NewRequest`, `client.Do`, `client.Get`).
- **Frontend**: browser `fetch()` for a small number of UI-only calls.

This doc lists the main outbound HTTP calls and what they’re used for.

## Frontend HTTP calls

### GitHub releases (update check)

- **Purpose**: show update badge when a newer release is available.
- **Where**: `frontend/src/App.tsx`
- **Call**: `GET https://api.github.com/repos/api-venom/SpotiFLAC/releases/latest`

Everything else download-related is routed through the Go backend via Wails bindings.

## Backend HTTP calls

### 1) Spotify metadata scraping

- **Where**: `backend/spotify_metadata.go`
- **Purpose**: resolve Spotify URLs into track metadata (ISRC, name, artists, album, cover images, etc.).
- **Key endpoints**:
  - `POST https://open.spotify.com/api/token` (web token)
  - `GET https://api.spotify.com/v1/tracks/{id}`
  - `GET https://api.spotify.com/v1/albums/{id}`
  - `GET https://api.spotify.com/v1/playlists/{id}`
  - `GET https://api.spotify.com/v1/artists/{id}`
  - `GET https://api.spotify.com/v1/artists/{id}/albums`
- **Notes**:
  - The client also downloads a remote secret blob used by the Spotify web-token logic:
    - `GET https://cdn.jsdelivr.net/gh/afkarxyz/secretBytes@refs/heads/main/secrets/secretBytes.json`

### 2) song.link service URL resolution

- **Where**: `backend/songlink.go`
- **Purpose**: map a Spotify track ID to known platform URLs (Tidal/Amazon).
- **Endpoint**:
  - `GET https://api.song.link/v1-alpha.1/links?url=<spotifyTrackUrl>`
- **Rate limiting**:
  - Enforces delays between calls (~7s) and caps request count to stay under song.link’s limit.

### 3) Tidal

- **Where**: `backend/tidal.go`
- **Used for**:
  - OAuth access token (client credentials)
  - search + metadata matching
  - playback/manifest retrieval and segment downloads
- **Key endpoints**:
  - `POST https://auth.tidal.com/v1/oauth2/token`
  - `GET https://api.tidal.com/v1/search/tracks?...`
  - Playback/manifest calls to Tidal’s playback endpoints (implemented in `backend/tidal.go`).

**API list sourcing**

- The app prefers a local `tidal.json` (next to the executable or working directory).
- Fallback remote:
  - `GET https://raw.githubusercontent.com/api-venom/SpotiFLAC/main/tidal.json`

**Quality fallback**

- If `HI_RES_LOSSLESS` fails for a track, the backend retries with `LOSSLESS`.

### 4) Qobuz

- **Where**: `backend/qobuz.go`
- **Used for**:
  - Search-by-ISRC
  - Fetching a stream/download URL
- **Key endpoints**:
  - `GET https://www.qobuz.com/api.json/0.2/track/search?query=<isrc>&limit=1&app_id=<id>`

**Stream URL APIs**

The code uses external proxy APIs to obtain a direct stream URL:

- Primary:
  - `GET https://dab.yeet.su/api/stream?trackId=<id>&quality=<code>`
- Fallback:
  - `GET https://dabmusic.xyz/api/stream?trackId=<id>&quality=<code>`

**Quality fallback chain**

- Requested `27` → try `27`, then `7`, then `6`
- Requested `7` → try `7`, then `6`

### 5) Amazon Music

- **Where**: `backend/amazon.go`
- **Used for**:
  - song.link mapping from Spotify → Amazon Music URL
  - submitting the Amazon URL to an external service that returns a downloadable file URL

Key endpoints:

- song.link mapping:
  - `GET https://api.song.link/v1-alpha.1/links?url=<spotifyTrackUrl>`
- external "double double" service (region-based):
  - Submit: `GET https://{us|eu}.doubledouble.top/dl?url=<amazonUrl>`
  - Poll: `GET https://{us|eu}.doubledouble.top/dl/<jobId>`

### 6) Cover art

- **Where**: `backend/cover.go`
- **Used for**: downloading the Spotify cover image to embed into the final file.
- **How**:
  - Uses the Spotify image URL already present in Spotify metadata.
  - If “max quality cover” is enabled, it tries a known “max” variant via `HEAD` and falls back if not available.

### 7) Lyrics

- **Where**: `backend/lyrics.go`
- **Provider**: LRCLIB
- **Endpoints**:
  - `GET https://lrclib.net/api/get?artist_name=<artist>&track_name=<track>`
  - `GET https://lrclib.net/api/search?q=<artist+track>`

### 8) FFmpeg installer downloads

- **Where**: `backend/ffmpeg.go`
- **Used for**: downloading FFmpeg binaries to an app-managed directory.
- **Sources**:
  - Windows/Linux: GitHub releases (BtbN builds)
  - macOS: `evermeet.cx` (ffmpeg + ffprobe)

## Debugging network issues

- If downloads fail, the backend logs status codes and which fallback it tried.
- song.link calls are intentionally slowed down; rapid bulk runs will wait between requests.

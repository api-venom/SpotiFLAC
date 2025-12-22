# Architecture

SpotiFLAC is a Wails v2 desktop app:

- **Backend (Go)**: does Spotify metadata scraping, service lookup, downloading, tagging, and optional audio remuxing.
- **Frontend (React + TypeScript + Vite)**: UI + settings; calls backend methods through Wails bindings.

## High-level flow

1. **User pastes a Spotify URL** (track/album/playlist/artist) in the UI.
2. **Frontend calls backend** `App.GetSpotifyMetadata(...)`.
3. **Backend fetches Spotify metadata** (track list, ISRCs, cover URLs, etc.) and returns a filtered JSON payload.
4. **Frontend displays the list** and the user selects tracks or downloads all.
5. **Frontend enqueues downloads** via `AddToDownloadQueue(...)` and then calls `DownloadTrack(...)` for each item.
6. **Backend downloads audio** from one of:
   - Tidal
   - Qobuz
   - Amazon Music

## Frontend ↔ Backend boundary (Wails)

- The frontend imports generated Wails bindings from `frontend/wailsjs/...`.
- Those bindings map to exported methods on the Go `App` struct in `app.go`.

Common backend entry points:

- `App.GetSpotifyMetadata(req)` → returns metadata JSON for Spotify URLs.
- `App.GetStreamingURLs(spotifyTrackID)` → uses song.link to map a Spotify track to service URLs.
- `App.DownloadTrack(req)` → downloads audio + embeds metadata.

## Download pipeline (backend)

### 1) Dedup / skip logic

Before downloading, the backend attempts to avoid duplicates:

- **ISRC check**: scans target folder for an existing `.flac` that already contains the same ISRC in Vorbis comments.
- **Filename check**: if a file exists at the expected output filename, it tries reading ISRC; if missing/invalid it may delete the file as "corrupted" and re-download.

### 2) Service selection

There are two common patterns:

- **Explicit service**: user chooses `tidal`, `qobuz`, or `amazon` and the backend downloads using that service.
- **Auto mode** (frontend behavior):
  1. Frontend calls `GetStreamingURLs` (song.link).
  2. It tries **Tidal**, then **Amazon**, then **Qobuz**.

### 3) Global “bit depth / quality” preference

The frontend sends a single cross-service field: `preferred_bit_depth`.

The backend maps this preference per service:

- **Tidal**:
  - `>= 24` → `HI_RES_LOSSLESS`
  - `< 24` → `LOSSLESS`
- **Qobuz**:
  - `>= 32` → `27` (Hi-Res)
  - `>= 24` → `7` (24-bit FLAC)
  - else → `6` (16-bit FLAC)

If a requested quality is not available, service-specific fallback logic is used (see `docs/NETWORKING.md`).

### 4) Audio handling (FFmpeg)

Some sources (notably Tidal) provide media via a manifest (DASH/BTS). The backend can use FFmpeg to:

- **Remux without re-encoding** (preferred): `-c:a copy`
- **Fallback to FLAC re-encode** when stream-copy fails.

FFmpeg is handled cross-platform via an app-managed install under the user home directory (e.g. `~/.spotiflac`).

### 5) Metadata + artwork + lyrics

After download, the backend can embed:

- Vorbis Comment fields (Title/Artist/Album/ISRC, etc.)
- Cover art (optionally “max quality” by probing Spotify image variants)
- Lyrics (fetched from LRCLIB)

## Settings

- Stored client-side (frontend settings layer) and used to shape each download request:
  - output path
  - filename & folder templates
  - service selection
  - embed cover/lyrics toggles
  - global bit depth preference

## Build-time structure

- Go embeds the frontend build output (`frontend/dist`) for Wails packaging.
- CI builds Windows/macOS/Linux artifacts via GitHub Actions.

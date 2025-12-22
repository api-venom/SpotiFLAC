# Changes (api-venom fork)

This document summarizes the main fork-specific changes made in this workspace.

## Audio quality / bit depth

- Added a **global bit-depth preference** that is sent from frontend → backend as `preferred_bit_depth`.
- Default is **24-bit** (best quality-by-default while balancing file size).
- Backend maps the bit-depth preference to each service’s native selector:
  - **Tidal**: `LOSSLESS` (16-bit) vs `HI_RES_LOSSLESS` (24-bit)
  - **Qobuz**: `6` (16-bit), `7` (24-bit), `27` (Hi-Res)

## Service fallbacks

- **Tidal**: if a track fails to download with `HI_RES_LOSSLESS`, it retries with `LOSSLESS`.
- **Qobuz**: quality fallback chain added:
  - `27 → 7 → 6`
  - `7 → 6`

## FFmpeg handling

- Tidal manifest processing now uses the app-managed FFmpeg path and prefers stream-copy (`-c:a copy`) before falling back to FLAC re-encode.

## Fork compatibility

- Tidal API list resolution prefers a local `tidal.json`, then falls back to:
  - `https://raw.githubusercontent.com/api-venom/SpotiFLAC/main/tidal.json`
- Updated various UI links and README links from upstream `afkarxyz/SpotiFLAC` to `api-venom/SpotiFLAC`.

## Build / CI

- Fixed invalid Go version pins (`go.mod` + CI) by aligning to Go `1.23.x`.
- Fixed Windows workflow shell incompatibilities (PowerShell vs `mkdir -p`).
- Ensured `frontend/dist` exists in-repo via a placeholder so Go embed builds don’t fail on fresh clones.

## Bug fixes

- Fixed a TypeScript duplicate `preferredBitDepth` declaration in `frontend/src/hooks/useDownload.ts`.

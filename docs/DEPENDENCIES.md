# Dependencies

This project is a Wails v2 desktop app with a Go backend and a React/TypeScript frontend.

## Runtime dependencies

- **FFmpeg** (optional but recommended):
  - Used for certain remux/format operations (notably Tidal manifest handling).
  - The app can download and manage FFmpeg automatically under the user home directory (see `backend/ffmpeg.go`).

## Build dependencies (local development)

### Backend

- **Go**: `1.23.x` (see `go.mod`)
- **Wails CLI** (v2)

### Frontend

- **Node.js** (LTS recommended)
- **pnpm**

Frontend package highlights (from `frontend/package.json`):

- React + Vite
- Tailwind CSS
- Radix UI components
- TypeScript + ESLint

## Common dev commands

From `frontend/`:

- Install: `pnpm install`
- Dev UI (when running Wails dev): `pnpm dev`
- Build UI bundle: `pnpm build`

From repo root:

- Run in dev mode: `wails dev`
- Build a release binary: `wails build`

(Exact Wails flags vary by OS and packaging target.)

## CI / GitHub Actions tooling

The GitHub Actions workflow builds artifacts for:

- Windows
- macOS
- Linux

It also uses tooling such as:

- **UPX** (binary compression)
- **AppImage tooling** on Linux
- **DMG creation** on macOS

See `.github/workflows/build.yml` for the authoritative build steps.

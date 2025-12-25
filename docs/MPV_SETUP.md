# MPV Player Integration Guide

This guide explains how to set up libmpv for native FLAC playback in SpotiFLAC.

## Problem

The WebView2/Chromium engine used by Wails doesn't support FLAC audio playback natively, causing `MEDIA_ERR_SRC_NOT_SUPPORTED` errors. MPV player can handle FLAC and other high-quality audio formats perfectly.

## Solution

SpotiFLAC now includes MPV integration through libmpv, which automatically takes over when HTML5 audio fails.

## Setup Instructions

### Windows

1. **Download MPV**
   - Visit: https://mpv.io/installation/
   - Or use the official builds: https://sourceforge.net/projects/mpv-player-windows/files/libmpv/
   - Download the latest `mpv-dev-x86_64-*.7z` archive

2. **Extract libmpv Files**
   - Extract the archive
   - Locate these files in the extracted folder:
     - `libmpv-2.dll` (or `mpv-2.dll`)
     - `mpv/client.h` (header file)

3. **Place Files in Project**
   ```
   SpotiFLAC/
   ├── backend/
   │   ├── mpv/
   │   │   └── client.h          # Place header here
   │   ├── mpv_libmpv.go         # MPV implementation
   │   ├── mpv_player.go         # Interface
   │   └── ...
   ├── mpv-2.dll                 # Place DLL in project root for development
   └── ...
   ```

4. **For Distribution**
   - Place `mpv-2.dll` in the same directory as your compiled `.exe`
   - Or in a `lib/` subdirectory and update PATH

### Linux

1. **Install libmpv**
   ```bash
   # Ubuntu/Debian
   sudo apt-get install libmpv-dev
   
   # Fedora
   sudo dnf install mpv-libs-devel
   
   # Arch
   sudo pacman -S mpv
   ```

2. **Verify Installation**
   ```bash
   pkg-config --modversion mpv
   ```

### macOS

1. **Install via Homebrew**
   ```bash
   brew install mpv
   ```

2. **Verify Installation**
   ```bash
   pkg-config --modversion mpv
   ```

## Building the App

### With libmpv (Recommended)

```bash
# Build with CGO enabled (default)
wails build

# The app will use MPV for audio playback
```

### Without libmpv (HTML5 Audio Only)

If libmpv is not available, the app will automatically fall back to the stub implementation and use HTML5 audio (limited format support).

```bash
# Build without CGO
CGO_ENABLED=0 wails build
```

## Testing MPV Integration

1. **Start the app**
2. **Try playing a FLAC track**
3. **Check the logs** - you should see:
   - `"HTML5 audio not supported, switching to MPV backend"` if HTML5 fails
   - `"MPV track loaded"` when MPV successfully loads
   - `"MPV playback started"` when playback begins

## Architecture

### Backend (Go)

- `backend/mpv_player.go` - Interface definition and stub implementation
- `backend/mpv_libmpv.go` - Real libmpv integration using CGO
- `app.go` - Wails methods exposed to frontend:
  - `MPVLoadTrack()` - Load audio URL
  - `MPVPlay()` - Start playback
  - `MPVPause()` - Pause playback
  - `MPVStop()` - Stop playback
  - `MPVSeek()` - Seek to position
  - `MPVSetVolume()` - Set volume
  - `MPVGetStatus()` - Get playback status

### Frontend (TypeScript)

- `frontend/src/lib/player.ts` - Player service with automatic fallback:
  1. Tries HTML5 audio first
  2. If HTML5 fails (MEDIA_ERR_SRC_NOT_SUPPORTED), automatically switches to MPV
  3. Polls MPV status every 200ms for UI updates

## Features

- ✅ **Automatic Fallback**: Tries HTML5 first, falls back to MPV if needed
- ✅ **FLAC Support**: Full FLAC playback including hi-res (24-bit/96kHz+)
- ✅ **Seeking**: Accurate seeking in audio files
- ✅ **Volume Control**: 0-100% volume range
- ✅ **Status Updates**: Real-time position, duration, and codec info
- ✅ **Hi-Res Detection**: Automatically detects hi-res audio (48kHz+, 24-bit+)

## Troubleshooting

### MPV DLL not found (Windows)

```
Error: "The specified module could not be found"
```

**Solution**: Place `mpv-2.dll` in the same directory as the .exe file

### Missing libmpv (Linux/macOS)

```
Error: "libmpv.so: cannot open shared object file"
```

**Solution**: Install libmpv using your package manager (see Setup Instructions)

### CGO Compilation Errors

```
Error: "gcc: command not found"
```

**Solution**: 
- Windows: Install MinGW-w64 or TDM-GCC
- Linux: `sudo apt-get install build-essential`
- macOS: `xcode-select --install`

### HTML5 Audio Still Being Used

The app will use HTML5 audio if:
- libmpv is not available (stub implementation active)
- The audio format is supported by WebView2 (MP3, OGG, etc.)

To force MPV mode, you can manually call `player.setUseMPV(true)` in the frontend.

## Performance

- **Startup**: MPV player initializes in <100ms
- **Track Loading**: Similar to HTML5 audio element
- **Status Polling**: 200ms interval (5 updates/second)
- **Memory**: ~10-20MB additional for MPV instance

## Future Enhancements

- [ ] Equalizer support via MPV's lavfi filters
- [ ] Gapless playback for albums
- [ ] Crossfade between tracks
- [ ] Audio effects (reverb, normalization, etc.)
- [ ] Spectrum analyzer via MPV's audio hooks
- [ ] Playlist management with MPV

## References

- [libmpv Documentation](https://mpv.io/manual/master/#libmpv)
- [MPV Client API](https://github.com/mpv-player/mpv/blob/master/libmpv/client.h)
- [CGO Documentation](https://golang.org/cmd/cgo/)

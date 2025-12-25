# Quick Start: Building with MPV Support

## TL;DR - Just Want It To Work?

1. **Run the build script:**
   ```cmd
   build-with-mpv.bat
   ```

2. **If it fails**, follow the setup steps below.

3. **Run the app:**
   ```cmd
   build\bin\SpotiFLAC.exe
   ```

That's it! MPV will automatically handle FLAC playback.

---

## Prerequisites

### 1. Install TDM-GCC (C Compiler for Windows)

Download and install from: https://jmeubank.github.io/tdm-gcc/download/

**Why?** CGO requires a C compiler to link with the MPV DLL.

### 2. Get libmpv Files

You need two files in the `backend/` directory:

**Option A: Download from official MPV builds**
1. Go to: https://sourceforge.net/projects/mpv-player-windows/files/libmpv/
2. Download latest `mpv-dev-x86_64-*.7z`
3. Extract and copy to `backend/`:
   - `libmpv-2.dll` (runtime library)
   - `mpv.lib` (import library for linking)

**Option B: Use existing mpv.exe installation**
If you already have `mpv.exe` working:
1. Find `libmpv-2.dll` in the MPV installation folder
2. Copy it to `backend/libmpv-2.dll`
3. Generate `mpv.lib` using the command below

### 3. Generate mpv.lib (if not included)

If you only have the DLL and need to generate the import library:

```cmd
REM From Developer Command Prompt for VS, or with lib.exe in PATH
lib /def:mpv.def /out:backend\mpv.lib /machine:x64
```

**Where to get `mpv.def`?**
- Included in mpv dev packages
- Or generate from DLL using `gendef libmpv-2.dll`
- Or use `dlltool` from MinGW: `dlltool -D libmpv-2.dll -d mpv.def -l mpv.lib`

---

## Building

### Automated Build (Recommended)

Just run:
```cmd
build-with-mpv.bat
```

This script:
- ✅ Checks for required files (libmpv-2.dll, mpv.lib)
- ✅ Sets CGO environment variables
- ✅ Adds backend/ to PATH for DLL discovery
- ✅ Builds with `wails build -tags cgo`
- ✅ Automatically copies DLL to build folder
- ✅ Shows helpful error messages if something fails

### Manual Build

If you prefer to build manually:

```cmd
REM Set CGO environment
set CGO_ENABLED=1
set CGO_CFLAGS=-I%CD%\backend
set CGO_LDFLAGS=-L%CD%\backend -lmpv
set PATH=%CD%\backend;%PATH%

REM Build
wails build -tags cgo

REM Copy DLL to output folder
copy backend\libmpv-2.dll build\bin\
```

---

## Troubleshooting

### ❌ "mpv player backend not implemented yet"

**Problem:** App was built without CGO, using stub implementation.

**Solution:** 
1. Delete `build/` folder
2. Run `build-with-mpv.bat` again
3. Verify `CGO_ENABLED=1` is set during build

### ❌ "libmpv-2.dll not found"

**Problem:** DLL is missing from backend/ or build/bin/ folder.

**Solutions:**
1. Check `backend\libmpv-2.dll` exists
2. After build, check `build\bin\libmpv-2.dll` exists
3. Run build script again (it auto-copies the DLL)

### ❌ "mpv.lib not found" or linker errors

**Problem:** Import library is missing or not in correct location.

**Solutions:**
1. Verify `backend\mpv.lib` exists
2. If not, generate it using one of the methods above
3. Make sure you're using 64-bit library for 64-bit build

### ❌ GCC not found

**Problem:** CGO can't find a C compiler.

**Solutions:**
1. Install TDM-GCC: https://jmeubank.github.io/tdm-gcc/
2. Or install MinGW-w64: https://www.mingw-w64.org/
3. Make sure `gcc` is in your PATH

Test with: `gcc --version`

### ❌ "failed to load libmpv" at runtime

**Problem:** App starts but crashes when trying to use MPV.

**Solutions:**
1. Make sure `libmpv-2.dll` is in same folder as SpotiFLAC.exe
2. Or add the folder to your PATH environment variable
3. Check DLL is 64-bit if your app is 64-bit

### ❌ Build succeeds but "MPV not implemented" error still shows

**Problem:** App was rebuilt but old build is cached.

**Solutions:**
1. Delete entire `build/` folder
2. Delete `frontend/dist/` folder
3. Run `wails build -tags cgo -clean`

---

## Verifying MPV is Working

### Check Build Logs

During build, you should see:
```
# backend [backend.test]
CGO_ENABLED=1
cgo: C compiler "gcc" found
```

If you see:
```
build constraints exclude all Go files in backend
```

Then CGO isn't enabled. Set `CGO_ENABLED=1` and rebuild.

### Check Runtime Logs

When you play a song, look for these logs:

**✅ SUCCESS - MPV is working:**
```
[debug] [player] MPV methods check: MPVLoadTrack=true MPVPlay=true MPVGetStatus=true
[debug] [player] MPV methods loaded successfully
[success] [player] MPV track loaded
[success] [player] MPV playback started
```

**❌ FAILURE - Using stub:**
```
[error] [player] MPV playback failed
mpv player backend not implemented yet
[info] [player] Falling back to HTML5 audio
```

---

## How It Works

### Build Process

1. **CGO Compilation:**
   - Go compiler calls GCC to compile C code in `mpv_libmpv.go`
   - GCC links against `mpv.lib` (import library)
   - Produces executable that dynamically loads `libmpv-2.dll` at runtime

2. **Build Tags:**
   - `-tags cgo` tells Go to compile files with `//go:build cgo` constraint
   - Without this tag, only `mpv_libmpv_stub.go` is compiled (returns "not implemented" errors)

3. **Runtime:**
   - App searches for `libmpv-2.dll`:
     1. Same folder as .exe (BEST)
     2. Windows system folders
     3. Folders in PATH environment variable
   - Loads DLL and calls `mpv_create()` to initialize player

### MPV Integration Architecture

```
Frontend (TypeScript)
    ↓ Wails bindings
App.go (Go)
    ↓ MPVPlayer interface
mpv_player.go
    ↓ (with CGO)
mpv_libmpv.go  ← Calls C functions from libmpv-2.dll
    ↓
libmpv-2.dll   ← Actual playback engine
```

**Without CGO:**
```
App.go → mpv_libmpv_stub.go → returns "not implemented" error
```

---

## Performance Notes

### MPV vs HTML5 Audio

| Feature | HTML5 Audio | MPV |
|---------|-------------|-----|
| FLAC Support | ❌ No (WebView2) | ✅ Yes |
| CPU Usage | Low | Medium |
| Seeking | Fast | Fast |
| Gapless | No | Yes |
| Format Support | MP3, OGG | All formats |
| Latency | Low (~50ms) | Higher (~200ms) |

### Why FLAC Doesn't Work in HTML5?

WebView2 uses Chromium's media pipeline, which doesn't include FLAC decoder by default (patent/licensing reasons). MPV includes libFLAC natively.

---

## File Locations

After successful build:

```
SpotiFLAC/
├── backend/
│   ├── libmpv-2.dll       ← Required for build
│   └── mpv.lib            ← Required for build
├── build/
│   └── bin/
│       ├── SpotiFLAC.exe  ← Your app
│       └── libmpv-2.dll   ← Auto-copied by build script
├── build-with-mpv.bat     ← Build script
└── docs/
    ├── MPV_SETUP.md       ← Detailed MPV guide
    ├── FLAC_PLAYBACK_FIX.md ← Architecture docs
    └── QUICK_START.md     ← This file
```

---

## Next Steps

### After Building Successfully

1. **Test FLAC Playback:**
   - Search for a song
   - Click play (without downloading)
   - Check logs for "MPV playback started"

2. **Test Seeking:**
   - Drag the progress bar
   - Should seek instantly without buffering

3. **Test Volume:**
   - Adjust volume slider
   - Volume changes should be instant

### If Playback Still Fails

Check these in order:

1. **Stream URL working?**
   - Look for "stream url: http://127.0.0.1:xxxxx/stream/xxx" in logs
   - Try opening that URL directly in browser
   - Should download a FLAC file

2. **MPV loading?**
   - Look for "MPV methods loaded successfully"
   - If not, app is using stub - rebuild with CGO

3. **Backend errors?**
   - Look for Go backend errors in terminal/logs
   - Common: "failed to get Tidal stream URL"

4. **Still stuck?**
   - Download the track first, then play from local file
   - Local files always work (served directly, no streaming)

---

## FAQ

### Q: Do I need mpv.exe installed?

**A:** No. You only need `libmpv-2.dll` (the library). The standalone `mpv.exe` player is not required.

### Q: Can I use VLC instead of MPV?

**A:** No. VLC uses libVLC which has a different API. MPV is specifically chosen for its simple C API and FLAC support.

### Q: Does this work on Linux/macOS?

**A:** Yes, but setup is different:
- **Linux:** `apt install libmpv-dev` then build with CGO
- **macOS:** Currently disabled (stub only) due to universal binary issues - will be fixed in future update

### Q: Why not just use ffmpeg?

**A:** MPV includes ffmpeg and handles all the audio pipeline. Using libmpv is simpler than reimplementing an audio player with ffmpeg.

### Q: Will this slow down my builds?

**A:** CGO builds are slightly slower (~10-20% longer) but negligible for a desktop app.

### Q: Can I toggle between HTML5 and MPV at runtime?

**A:** Yes! The player automatically falls back:
1. Try HTML5 audio first (faster startup)
2. If error code 4 (format not supported), switch to MPV
3. You can also manually toggle in settings (future feature)

---

## Support

- **Documentation:** See `docs/MPV_SETUP.md` for detailed setup
- **Architecture:** See `docs/FLAC_PLAYBACK_FIX.md` for how it works
- **Issues:** https://github.com/afkarxyz/SpotiFLAC/issues

---

**Last Updated:** 2025-12-25  
**MPV Version:** libmpv 2.x (any recent version)  
**Tested On:** Windows 10/11 64-bit

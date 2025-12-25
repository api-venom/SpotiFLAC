# Quick Start: Fixing FLAC Playback

If you're seeing the error:
```
[error] [player] audio error: code=4 (MEDIA_ERR_SRC_NOT_SUPPORTED)
```

Your WebView browser doesn't support FLAC audio playback. Here's how to fix it:

## Quick Fix (Windows)

1. **Download MPV DLL**
   - Go to: https://sourceforge.net/projects/mpv-player-windows/files/libmpv/
   - Download the latest `mpv-dev-x86_64-*.7z`
   - Extract and find `libmpv-2.dll` (or `mpv-2.dll`)

2. **Place DLL in Project**
   - Copy `mpv-2.dll` to your SpotiFLAC project root folder
   - Or place it next to your compiled `.exe` file

3. **Rebuild the App**
   ```bash
   wails build
   ```

4. **That's it!** The app will now automatically use MPV when FLAC playback fails.

## What Happens

The app now has **automatic fallback**:

1. **First**: Tries to play with HTML5 audio (built-in browser)
2. **If that fails**: Automatically switches to MPV player
3. **MPV handles**: FLAC, hi-res audio, and any format `mpv.exe` supports

You'll see these log messages when it works:

```
[info] [player] HTML5 audio not supported, switching to MPV backend
[success] [player] MPV track loaded
[success] [player] MPV playback started
```

## For Developers

For complete setup instructions and technical details, see [`docs/MPV_SETUP.md`](./MPV_SETUP.md).

## No MPV Available?

If you can't install MPV, the app will continue to work with these formats:
- ✅ MP3
- ✅ OGG Vorbis  
- ✅ M4A/AAC
- ❌ FLAC (requires MPV)
- ❌ Hi-Res formats (requires MPV)

Consider downloading from services that support MP3/M4A if MPV is not available.

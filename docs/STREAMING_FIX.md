# Streaming Fix Documentation

## Problem Summary

The stream server was completely broken and returning "upstream returned html (not an audio stream)" errors. Users could not play any songs via streaming.

### Root Cause

The [`resolveRemoteStreamURL()`](../backend/stream_server.go:368) function in `backend/stream_server.go` was returning Tidal web page URLs (e.g., `https://listen.tidal.com/track/123456`) instead of actual authenticated audio stream URLs. When the proxy tried to fetch these URLs, it received HTML pages from Tidal's website, which were correctly rejected by the HTML detection logic at lines 340-343.

### User Impact

```
[23:12:15] [error] [player]
audio error: code=4 (MEDIA_ERR_SRC_NOT_SUPPORTED) 
src=http://127.0.0.1:58401/stream/ad9b95db39dcf32e903b9a444391af4b

[23:12:15] [error] [player]
playback failed
NotSupportedError: Failed to load because no supported source was found.
```

User quote: *"i am not able to play song nahh bcz of this error idk why before it was not coming playback was smooth"*

## Solution Implemented

### 1. Created New Method in TidalDownloader

**File:** [`backend/tidal.go`](../backend/tidal.go:587)

Added [`GetTidalFileURL(trackID int64, quality string) (string, error)`](../backend/tidal.go:587) method that:

- Calls existing [`GetDownloadURL()`](../backend/tidal.go:523) to get authenticated stream data
- Handles two API response formats:
  - **v1 API:** Returns direct FLAC download URL
  - **v2 API:** Returns base64-encoded manifest (BTS JSON or DASH XML)
- Parses BTS manifests to extract direct stream URLs
- Returns error for DASH manifests (multi-segment streams requiring HLS/DASH player)

```go
func (t *TidalDownloader) GetTidalFileURL(trackID int64, quality string) (string, error) {
    downloadURL, err := t.GetDownloadURL(trackID, quality)
    if err != nil {
        return "", err
    }

    // Handle manifest-based streams (v2 API)
    if strings.HasPrefix(downloadURL, "MANIFEST:") {
        manifestB64 := strings.TrimPrefix(downloadURL, "MANIFEST:")
        
        // Parse manifest to extract first direct URL
        directURL, initURL, mediaURLs, err := parseManifest(manifestB64)
        if err != nil {
            return "", fmt.Errorf("failed to parse manifest for streaming: %w", err)
        }

        // If BTS format with direct URL, return it
        if directURL != "" {
            return directURL, nil
        }

        // DASH format requires segment stitching - not supported for streaming
        if initURL != "" && len(mediaURLs) > 0 {
            return "", fmt.Errorf("DASH manifest detected - streaming not supported, please download track first")
        }

        return "", fmt.Errorf("invalid manifest format")
    }

    // Direct URL (v1 API) - can be streamed directly
    return downloadURL, nil
}
```

### 2. Updated Stream Server Resolution

**File:** [`backend/stream_server.go`](../backend/stream_server.go:368)

Modified [`resolveRemoteStreamURL()`](../backend/stream_server.go:368) to:

1. **Get SongLink mapping:** Convert Spotify track ID to Tidal URL via SongLink API
2. **Extract Tidal track ID:** Parse numeric track ID from Tidal URL (e.g., `123456` from `https://listen.tidal.com/track/123456`)
3. **Call Tidal API:** Use [`GetTidalFileURL()`](../backend/tidal.go:587) to get authenticated stream URL
4. **Return stream URL:** Direct playable FLAC URL that the proxy can fetch

**Key Changes:**

```go
func resolveRemoteStreamURL(spotifyID, isrc, audioFormat string) (string, error) {
    // Get Tidal URL from SongLink
    client := NewSongLinkClient()
    urls, err := client.GetAllURLsFromSpotify(spotifyID)
    if err != nil {
        return "", fmt.Errorf("failed to resolve provider URLs: %w", err)
    }

    if urls.TidalURL != "" {
        // Extract numeric track ID
        trackID, err := extractTidalTrackID(urls.TidalURL)
        if err != nil {
            return "", fmt.Errorf("invalid Tidal URL format: %w", err)
        }
        
        // Get authenticated stream URL via Tidal API
        downloader := NewTidalDownloader("")
        quality := audioFormat
        if quality == "" {
            quality = "LOSSLESS"
        }
        
        streamURL, err := downloader.GetTidalFileURL(trackID, quality)
        if err != nil {
            return "", fmt.Errorf("failed to get Tidal stream URL: %w", err)
        }
        
        return streamURL, nil
    }

    return "", fmt.Errorf("no provider URL available")
}
```

### 3. Added Helper Function

**File:** [`backend/stream_server.go`](../backend/stream_server.go:419)

Created [`extractTidalTrackID(tidalURL string) (int64, error)`](../backend/stream_server.go:419) to parse track IDs:

```go
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
```

## How It Works Now

### Streaming Flow

```
1. User clicks play on Spotify track
   ↓
2. Frontend calls GetStreamURL(spotifyID, isrc, ...)
   ↓
3. Stream server checks for local file by ISRC
   - If found: Serve local FLAC file (fastest)
   - If not found: Continue to remote resolution
   ↓
4. resolveRemoteStreamURL() workflow:
   a. SongLink API: spotifyID → Tidal track URL
   b. extractTidalTrackID: Parse numeric ID from URL
   c. TidalDownloader.GetTidalFileURL():
      - Authenticate with Tidal API
      - Request playback info for track ID
      - Parse response (v1 direct URL or v2 manifest)
      - Extract streamable URL
   d. Return authenticated stream URL
   ↓
5. Stream server creates token for URL
   ↓
6. Returns: http://127.0.0.1:58401/stream/{token}
   ↓
7. Frontend loads URL in <audio> element
   ↓
8. Browser requests stream
   ↓
9. proxyRemote() fetches from Tidal CDN and streams to browser
```

### API Response Formats

**Tidal v1 API Response:**
```json
[
  {
    "OriginalTrackUrl": "https://[cdn].tidal.com/audio/path/to/file.flac?token=xxx"
  }
]
```

**Tidal v2 API Response (BTS Manifest):**
```json
{
  "version": "2.0",
  "data": {
    "manifest": "base64_encoded_json",
    "manifestMimeType": "application/vnd.tidal.bts"
  }
}
```

**Decoded BTS Manifest:**
```json
{
  "mimeType": "audio/flac",
  "codecs": "flac",
  "encryptionType": "NONE",
  "urls": [
    "https://[cdn].tidal.com/audio/path/to/file.flac?token=xxx"
  ]
}
```

## Known Limitations

### DASH Manifests Not Supported for Streaming

Some Tidal tracks use DASH (Dynamic Adaptive Streaming over HTTP) format, which returns:

```xml
<MPD>
  <Period>
    <AdaptationSet>
      <Representation>
        <SegmentTemplate initialization="init.m4s" media="segment_$Number$.m4s">
          <SegmentTimeline>
            <S d="192512" r="299"/>
          </SegmentTimeline>
        </SegmentTemplate>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>
```

These tracks require:
1. Downloading init segment
2. Downloading 100-300+ media segments
3. Stitching segments together
4. Remuxing from fMP4 to native FLAC

**Workaround:** Download the track first, then play from local file. The stream server prioritizes local files, so subsequent playback will be instant.

## Testing

### Test Streaming Playback

1. **Rebuild the application:**
   ```bash
   wails build
   ```

2. **Launch the app and search for a track**

3. **Click play without downloading**

4. **Check logs for streaming workflow:**
   ```
   [info] [player] play: Track Name - Artist
   [debug] [player] spotifyId=xxx isrc=xxx
   [success] [player] stream url: http://127.0.0.1:58401/stream/xxx
   [debug] [player] canPlayType: flac=probably mp3=probably ogg=probably
   [info] [player] playback started
   ```

5. **Verify audio plays without errors**

### Test Local File Priority

1. **Download a track**
2. **Close and reopen app** (or refresh)
3. **Play the same track**
4. **Verify logs show local file served:**
   ```
   [debug] stream server: serving local file: C:/Music/track.flac
   ```

### Test DASH Fallback

If you encounter a DASH manifest track:

1. **Error message in console:**
   ```
   [error] [player] playback failed
   Error: DASH manifest detected - streaming not supported, please download track first
   ```

2. **Download the track**
3. **Play again** - should work from local file

## Files Modified

### Backend Changes
- [`backend/tidal.go`](../backend/tidal.go:587) - Added `GetTidalFileURL()` method (lines 587-621)
- [`backend/stream_server.go`](../backend/stream_server.go:1) - Added `strconv` import
- [`backend/stream_server.go`](../backend/stream_server.go:368) - Fixed `resolveRemoteStreamURL()` function
- [`backend/stream_server.go`](../backend/stream_server.go:419) - Added `extractTidalTrackID()` helper

### No Frontend Changes Required

The frontend already properly handles:
- Stream URL loading
- Error fallback
- Local file priority
- MPV fallback for unsupported formats

## Related Documentation

- [FLAC Playback Fix](./FLAC_PLAYBACK_FIX.md) - MPV integration for FLAC decoding
- [MPV Setup Guide](./MPV_SETUP.md) - Building with libmpv support
- [Networking](./NETWORKING.md) - Stream server architecture

## Troubleshooting

### "upstream returned html (not an audio stream)"

**Before fix:** Stream server was trying to proxy Tidal web page URLs  
**After fix:** Stream server uses authenticated Tidal API URLs

If you still see this error:
1. Check that you rebuilt the app after applying changes
2. Verify Tidal API is accessible (not blocked by firewall)
3. Try a different track (current track may not be available in your region)

### "DASH manifest detected - streaming not supported"

This is expected for some tracks. **Solution:**
1. Download the track first
2. Subsequent playback will use local file

### "failed to get Tidal stream URL"

Possible causes:
- Tidal API server is down
- Track not available in any region
- Network connectivity issues

**Solution:**
1. Check internet connection
2. Try downloading the track instead
3. Check backend logs for detailed error messages

## Future Improvements

### Potential Enhancements

1. **DASH Streaming Support**
   - Implement segment-based streaming in stream server
   - On-the-fly segment stitching and remuxing
   - Buffering strategy for seamless playback

2. **Amazon Music Streaming**
   - Implement Amazon API authentication
   - Parse Amazon stream URLs
   - Add to `resolveRemoteStreamURL()` fallback chain

3. **Caching Layer**
   - Cache authenticated URLs for 1-2 hours
   - Reduce API calls for repeated playback
   - Improve startup latency

4. **Progressive Download**
   - Download while streaming
   - Convert streaming session to local file
   - Seamless transition from remote to local

## Credits

**Issue reported by:** User experiencing "upstream returned html" errors  
**Root cause identified:** Stream server returning web page URLs instead of CDN URLs  
**Solution implemented:** Tidal API integration for authenticated stream URL retrieval

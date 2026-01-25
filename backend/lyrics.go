package backend

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Word-level lyrics types (from LyricsPlus API)
type WordLyricsSyllable struct {
	Time     int    `json:"time"`     // Start time in milliseconds
	Duration int    `json:"duration"` // Duration in milliseconds
	Text     string `json:"text"`     // Word/syllable text
}

type WordLyricsLine struct {
	Time     int                  `json:"time"`     // Line start time in ms
	Duration int                  `json:"duration"` // Line duration in ms
	Text     string               `json:"text"`     // Full line text
	Syllabus []WordLyricsSyllable `json:"syllabus"` // Word-by-word timing
	Element  *struct {
		Key      string `json:"key,omitempty"`
		SongPart string `json:"songPart,omitempty"`
		Singer   string `json:"singer,omitempty"`
	} `json:"element,omitempty"`
}

type WordLyricsMetadata struct {
	Source        string `json:"source,omitempty"`
	Title         string `json:"title,omitempty"`
	Language      string `json:"language,omitempty"`
	TotalDuration string `json:"totalDuration,omitempty"`
}

type WordLyricsResponse struct {
	KpoeTools string             `json:"KpoeTools,omitempty"`
	Type      string             `json:"type"` // "Word" for word-level, "Line" for line-level
	Metadata  WordLyricsMetadata `json:"metadata"`
	Lyrics    []WordLyricsLine   `json:"lyrics"`
	Error     string             `json:"error,omitempty"`
}

type LRCLibResponse struct {
	ID           int     `json:"id"`
	Name         string  `json:"name"`
	TrackName    string  `json:"trackName"`
	ArtistName   string  `json:"artistName"`
	AlbumName    string  `json:"albumName"`
	Duration     float64 `json:"duration"`
	Instrumental bool    `json:"instrumental"`
	PlainLyrics  string  `json:"plainLyrics"`
	SyncedLyrics string  `json:"syncedLyrics"`
}

type LyricsLine struct {
	StartTimeMs string `json:"startTimeMs"`
	Words       string `json:"words"`
	EndTimeMs   string `json:"endTimeMs"`
}

type LyricsResponse struct {
	Error    bool         `json:"error"`
	SyncType string       `json:"syncType"`
	Lines    []LyricsLine `json:"lines"`
}

type LyricsDownloadRequest struct {
	SpotifyID           string `json:"spotify_id"`
	TrackName           string `json:"track_name"`
	ArtistName          string `json:"artist_name"`
	AlbumName           string `json:"album_name"`
	AlbumArtist         string `json:"album_artist"`
	ReleaseDate         string `json:"release_date"`
	OutputDir           string `json:"output_dir"`
	FilenameFormat      string `json:"filename_format"`
	TrackNumber         bool   `json:"track_number"`
	Position            int    `json:"position"`
	UseAlbumTrackNumber bool   `json:"use_album_track_number"`
	DiscNumber          int    `json:"disc_number"`
}

type LyricsDownloadResponse struct {
	Success       bool   `json:"success"`
	Message       string `json:"message"`
	File          string `json:"file,omitempty"`
	Error         string `json:"error,omitempty"`
	AlreadyExists bool   `json:"already_exists,omitempty"`
}

type LyricsClient struct {
	httpClient *http.Client
}

func NewLyricsClient() *LyricsClient {
	return &LyricsClient{
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

func (c *LyricsClient) FetchLyricsWithMetadata(trackName, artistName string, duration int) (*LyricsResponse, error) {

	apiBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9scmNsaWIubmV0L2FwaS9nZXQ/YXJ0aXN0X25hbWU9")
	apiURL := fmt.Sprintf("%s%s&track_name=%s",
		string(apiBase),
		url.QueryEscape(artistName),
		url.QueryEscape(trackName))

	if duration > 0 {
		apiURL = fmt.Sprintf("%s&duration=%d", apiURL, duration)
	}

	resp, err := c.httpClient.Get(apiURL)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch from LRCLIB: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("LRCLIB returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read LRCLIB response: %v", err)
	}

	var lrcLibResp LRCLibResponse
	if err := json.Unmarshal(body, &lrcLibResp); err != nil {
		return nil, fmt.Errorf("failed to parse LRCLIB response: %v", err)
	}

	return c.convertLRCLibToLyricsResponse(&lrcLibResp), nil
}

func (c *LyricsClient) convertLRCLibToLyricsResponse(lrcLib *LRCLibResponse) *LyricsResponse {
	resp := &LyricsResponse{
		Error:    false,
		SyncType: "LINE_SYNCED",
		Lines:    []LyricsLine{},
	}

	lyricsText := lrcLib.SyncedLyrics
	if lyricsText == "" {
		lyricsText = lrcLib.PlainLyrics
		resp.SyncType = "UNSYNCED"
	}

	if lyricsText == "" {
		resp.Error = true
		return resp
	}

	lines := strings.Split(lyricsText, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		if strings.HasPrefix(line, "[") && len(line) > 10 {
			closeBracket := strings.Index(line, "]")
			if closeBracket > 0 {
				timestamp := line[1:closeBracket]
				words := strings.TrimSpace(line[closeBracket+1:])

				ms := lrcTimestampToMs(timestamp)
				resp.Lines = append(resp.Lines, LyricsLine{
					StartTimeMs: fmt.Sprintf("%d", ms),
					Words:       words,
				})
				continue
			}
		}

		resp.Lines = append(resp.Lines, LyricsLine{
			StartTimeMs: "",
			Words:       line,
		})
	}

	return resp
}

func lrcTimestampToMs(timestamp string) int64 {
	var minutes, seconds, centiseconds int64

	n, _ := fmt.Sscanf(timestamp, "%d:%d.%d", &minutes, &seconds, &centiseconds)
	if n >= 2 {
		return minutes*60*1000 + seconds*1000 + centiseconds*10
	}
	return 0
}

func (c *LyricsClient) FetchLyricsFromLRCLibSearch(trackName, artistName string) (*LyricsResponse, error) {
	query := fmt.Sprintf("%s %s", artistName, trackName)
	apiBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9scmNsaWIubmV0L2FwaS9zZWFyY2g/cT0=")
	apiURL := fmt.Sprintf("%s%s", string(apiBase), url.QueryEscape(query))

	resp, err := c.httpClient.Get(apiURL)
	if err != nil {
		return nil, fmt.Errorf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read failed: %v", err)
	}

	var results []LRCLibResponse
	if err := json.Unmarshal(body, &results); err != nil {
		return nil, fmt.Errorf("parse failed: %v", err)
	}

	if len(results) == 0 {
		return nil, fmt.Errorf("no results found")
	}

	var best *LRCLibResponse
	for i := range results {
		if results[i].SyncedLyrics != "" {
			best = &results[i]
			break
		}
		if best == nil && results[i].PlainLyrics != "" {
			best = &results[i]
		}
	}

	if best == nil {
		best = &results[0]
	}

	return c.convertLRCLibToLyricsResponse(best), nil
}

func simplifyTrackName(name string) string {

	if idx := strings.Index(name, "("); idx > 0 {
		name = strings.TrimSpace(name[:idx])
	}

	if idx := strings.Index(name, " - "); idx > 0 {
		name = strings.TrimSpace(name[:idx])
	}
	return name
}

// cleanTrackNameForLyrics removes parenthetical info like "(feat. X)" or "(Remix)" from track name
// This helps match lyrics APIs that expect clean track names
func cleanTrackNameForLyrics(name string) string {
	if name == "" {
		return name
	}

	// Remove common parenthetical patterns: (feat. X), (ft. X), (Remix), (Live), etc.
	// Keep the base track name
	patterns := []string{
		`\s*\(feat\.?\s+[^)]+\)`,       // (feat. Artist)
		`\s*\(ft\.?\s+[^)]+\)`,          // (ft. Artist)
		`\s*\(featuring\s+[^)]+\)`,      // (featuring Artist)
		`\s*\(with\s+[^)]+\)`,           // (with Artist)
		`\s*\[feat\.?\s+[^]]+\]`,        // [feat. Artist]
		`\s*\[ft\.?\s+[^]]+\]`,          // [ft. Artist]
		`\s*\[featuring\s+[^]]+\]`,      // [featuring Artist]
		`\s*\[with\s+[^]]+\]`,           // [with Artist]
	}

	result := name
	for _, pattern := range patterns {
		re := regexp.MustCompile(`(?i)` + pattern)
		result = re.ReplaceAllString(result, "")
	}

	return strings.TrimSpace(result)
}

// cleanArtistNameForLyrics extracts the primary artist from a comma or "feat" separated list
// e.g., "The Weeknd, Justice" -> "The Weeknd"
// e.g., "Artist feat. Other" -> "Artist"
func cleanArtistNameForLyrics(name string) string {
	if name == "" {
		return name
	}

	// First, remove any "feat." or similar suffixes
	featPatterns := []string{
		`\s+feat\.?\s+.*$`,      // feat. Artist at end
		`\s+ft\.?\s+.*$`,        // ft. Artist at end
		`\s+featuring\s+.*$`,    // featuring Artist at end
		`\s+with\s+.*$`,         // with Artist at end
		`\s+&\s+.*$`,            // & Artist at end
		`\s+and\s+.*$`,          // and Artist at end
	}

	result := name
	for _, pattern := range featPatterns {
		re := regexp.MustCompile(`(?i)` + pattern)
		result = re.ReplaceAllString(result, "")
	}

	// Then split by comma and take first artist
	if idx := strings.Index(result, ","); idx > 0 {
		result = strings.TrimSpace(result[:idx])
	}

	// Also handle semicolon separator
	if idx := strings.Index(result, ";"); idx > 0 {
		result = strings.TrimSpace(result[:idx])
	}

	return strings.TrimSpace(result)
}

func (c *LyricsClient) FetchLyricsAllSources(spotifyID, trackName, artistName string, duration int) (*LyricsResponse, string, error) {

	resp, err := c.FetchLyricsWithMetadata(trackName, artistName, duration)
	if err == nil && resp != nil && !resp.Error && len(resp.Lines) > 0 {
		return resp, "LRCLIB", nil
	}
	fmt.Printf("   LRCLIB exact: %v\n", err)

	resp, err = c.FetchLyricsFromLRCLibSearch(trackName, artistName)
	if err == nil && resp != nil && !resp.Error && len(resp.Lines) > 0 {
		return resp, "LRCLIB Search", nil
	}
	fmt.Printf("   LRCLIB search: %v\n", err)

	simplifiedTrack := simplifyTrackName(trackName)
	if simplifiedTrack != trackName {
		fmt.Printf("   Trying simplified name: %s\n", simplifiedTrack)

		resp, err = c.FetchLyricsWithMetadata(simplifiedTrack, artistName, duration)
		if err == nil && resp != nil && !resp.Error && len(resp.Lines) > 0 {
			return resp, "LRCLIB (simplified)", nil
		}

		resp, err = c.FetchLyricsFromLRCLibSearch(simplifiedTrack, artistName)
		if err == nil && resp != nil && !resp.Error && len(resp.Lines) > 0 {
			return resp, "LRCLIB Search (simplified)", nil
		}
	}

	return nil, "", fmt.Errorf("lyrics not found in any source")
}

func (c *LyricsClient) ConvertToLRC(lyrics *LyricsResponse, trackName, artistName string) string {
	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("[ti:%s]\n", trackName))
	sb.WriteString(fmt.Sprintf("[ar:%s]\n", artistName))
	sb.WriteString("[by:SpotiFLAC]\n")
	sb.WriteString("\n")

	for _, line := range lyrics.Lines {
		// Unsynced: just write the line text (skip truly-empty lines).
		if line.StartTimeMs == "" {
			if strings.TrimSpace(line.Words) == "" {
				continue
			}
			sb.WriteString(fmt.Sprintf("%s\n", line.Words))
			continue
		}

		// Synced: preserve beat-only/empty words as timestamp-only markers.
		timestamp := msToLRCTimestamp(line.StartTimeMs)
		sb.WriteString(fmt.Sprintf("%s%s\n", timestamp, line.Words))
	}

	return sb.String()
}

func msToLRCTimestamp(msStr string) string {
	var ms int64
	fmt.Sscanf(msStr, "%d", &ms)

	totalSeconds := ms / 1000
	minutes := totalSeconds / 60
	seconds := totalSeconds % 60
	centiseconds := (ms % 1000) / 10

	return fmt.Sprintf("[%02d:%02d.%02d]", minutes, seconds, centiseconds)
}

func buildLyricsFilename(trackName, artistName, albumName, albumArtist, releaseDate, filenameFormat string, includeTrackNumber bool, position, discNumber int) string {
	safeTitle := sanitizeFilename(trackName)
	safeArtist := sanitizeFilename(artistName)
	safeAlbum := sanitizeFilename(albumName)
	safeAlbumArtist := sanitizeFilename(albumArtist)

	year := ""
	if len(releaseDate) >= 4 {
		year = releaseDate[:4]
	}

	var filename string

	if strings.Contains(filenameFormat, "{") {
		filename = filenameFormat
		filename = strings.ReplaceAll(filename, "{title}", safeTitle)
		filename = strings.ReplaceAll(filename, "{artist}", safeArtist)
		filename = strings.ReplaceAll(filename, "{album}", safeAlbum)
		filename = strings.ReplaceAll(filename, "{album_artist}", safeAlbumArtist)
		filename = strings.ReplaceAll(filename, "{year}", year)

		if discNumber > 0 {
			filename = strings.ReplaceAll(filename, "{disc}", fmt.Sprintf("%d", discNumber))
		} else {
			filename = strings.ReplaceAll(filename, "{disc}", "")
		}

		if position > 0 {
			filename = strings.ReplaceAll(filename, "{track}", fmt.Sprintf("%02d", position))
		} else {

			filename = regexp.MustCompile(`\{track\}\.\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*-\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*`).ReplaceAllString(filename, "")
		}
	} else {

		switch filenameFormat {
		case "artist-title":
			filename = fmt.Sprintf("%s - %s", safeArtist, safeTitle)
		case "title":
			filename = safeTitle
		default:
			filename = fmt.Sprintf("%s - %s", safeTitle, safeArtist)
		}

		if includeTrackNumber && position > 0 {
			filename = fmt.Sprintf("%02d. %s", position, filename)
		}
	}

	return filename + ".lrc"
}

func findAudioFileForLyrics(dir, trackName, artistName string) string {

	safeTitle := sanitizeFilename(trackName)
	safeArtist := sanitizeFilename(artistName)

	audioExts := []string{".flac", ".mp3", ".m4a", ".FLAC", ".MP3", ".M4A"}

	patterns := []string{
		fmt.Sprintf("%s - %s", safeTitle, safeArtist),
		fmt.Sprintf("%s - %s", safeArtist, safeTitle),
		safeTitle,
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		filename := entry.Name()
		baseName := strings.TrimSuffix(filename, filepath.Ext(filename))

		for _, pattern := range patterns {
			if strings.HasPrefix(baseName, pattern) || strings.Contains(baseName, pattern) {
				ext := strings.ToLower(filepath.Ext(filename))
				for _, audioExt := range audioExts {
					if ext == strings.ToLower(audioExt) {
						return filepath.Join(dir, filename)
					}
				}
			}
		}
	}

	return ""
}

func (c *LyricsClient) DownloadLyrics(req LyricsDownloadRequest) (*LyricsDownloadResponse, error) {
	if req.SpotifyID == "" {
		return &LyricsDownloadResponse{
			Success: false,
			Error:   "Spotify ID is required",
		}, fmt.Errorf("spotify ID is required")
	}

	outputDir := req.OutputDir
	if outputDir == "" {
		outputDir = GetDefaultMusicPath()
	} else {
		outputDir = NormalizePath(outputDir)
	}

	safeArtist := sanitizeFilename(req.AlbumArtist)
	if safeArtist == "" {
		safeArtist = sanitizeFilename(req.ArtistName)
	}
	safeAlbum := sanitizeFilename(req.AlbumName)

	if safeArtist != "" && safeAlbum != "" {
		artistAlbumPath := filepath.Join(outputDir, safeArtist, safeAlbum)
		if info, err := os.Stat(artistAlbumPath); err == nil && info.IsDir() {
			outputDir = artistAlbumPath
		} else {

			artistPath := filepath.Join(outputDir, safeArtist)
			if info, err := os.Stat(artistPath); err == nil && info.IsDir() {
				outputDir = artistPath
			}
		}
	}

	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return &LyricsDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to create output directory: %v", err),
		}, err
	}

	filenameFormat := req.FilenameFormat
	if filenameFormat == "" {
		filenameFormat = "title-artist"
	}
	filename := buildLyricsFilename(req.TrackName, req.ArtistName, req.AlbumName, req.AlbumArtist, req.ReleaseDate, filenameFormat, req.TrackNumber, req.Position, req.DiscNumber)
	filePath := filepath.Join(outputDir, filename)

	if fileInfo, err := os.Stat(filePath); err == nil && fileInfo.Size() > 0 {
		return &LyricsDownloadResponse{
			Success:       true,
			Message:       "Lyrics file already exists",
			File:          filePath,
			AlreadyExists: true,
		}, nil
	}

	audioDuration := 0
	audioFile := findAudioFileForLyrics(outputDir, req.TrackName, req.ArtistName)
	if audioFile != "" {
		duration, err := GetAudioDuration(audioFile)
		if err == nil && duration > 0 {
			audioDuration = int(duration)
			fmt.Printf("[DownloadLyrics] Found audio file, duration: %d seconds\n", audioDuration)
		}
	}

	lyrics, _, err := c.FetchLyricsAllSources(req.SpotifyID, req.TrackName, req.ArtistName, audioDuration)
	if err != nil {
		return &LyricsDownloadResponse{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	lrcContent := c.ConvertToLRC(lyrics, req.TrackName, req.ArtistName)

	if err := os.WriteFile(filePath, []byte(lrcContent), 0644); err != nil {
		return &LyricsDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to write LRC file: %v", err),
		}, err
	}

	return &LyricsDownloadResponse{
		Success: true,
		Message: "Lyrics downloaded successfully",
		File:    filePath,
	}, nil
}

// FetchWordLyrics fetches word-level synced lyrics from LyricsPlus API
// This provides syllable/word-level timing for true karaoke-style sync
func (c *LyricsClient) FetchWordLyrics(trackName, artistName, albumName string, durationSec int) (*WordLyricsResponse, error) {
	// Clean track name and artist name for better API matching
	cleanedTrack := cleanTrackNameForLyrics(trackName)
	cleanedArtist := cleanArtistNameForLyrics(artistName)

	fmt.Printf("[FetchWordLyrics] Original: track=%q, artist=%q\n", trackName, artistName)
	fmt.Printf("[FetchWordLyrics] Cleaned: track=%q, artist=%q\n", cleanedTrack, cleanedArtist)

	// LyricsPlus API endpoint
	apiBase := "https://lyricsplus.prjktla.workers.dev/v2/lyrics/get"

	params := url.Values{}
	params.Set("title", cleanedTrack)
	params.Set("artist", cleanedArtist)
	if albumName != "" {
		params.Set("album", albumName)
	}
	if durationSec > 0 {
		params.Set("duration", fmt.Sprintf("%d", durationSec))
	}
	// Request word-level lyrics from multiple sources
	params.Set("source", "apple,lyricsplus,musixmatch,spotify,musixmatch-word")

	apiURL := fmt.Sprintf("%s?%s", apiBase, params.Encode())
	fmt.Printf("[FetchWordLyrics] Fetching from: %s\n", apiURL)

	resp, err := c.httpClient.Get(apiURL)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch word lyrics: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("LyricsPlus returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %v", err)
	}

	var wordLyrics WordLyricsResponse
	if err := json.Unmarshal(body, &wordLyrics); err != nil {
		return nil, fmt.Errorf("failed to parse response: %v", err)
	}

	if wordLyrics.Error != "" {
		return nil, fmt.Errorf("API error: %s", wordLyrics.Error)
	}

	if len(wordLyrics.Lyrics) == 0 {
		return nil, fmt.Errorf("no lyrics found")
	}

	fmt.Printf("[FetchWordLyrics] Got %d lines, type: %s, source: %s\n",
		len(wordLyrics.Lyrics), wordLyrics.Type, wordLyrics.Metadata.Source)

	return &wordLyrics, nil
}

// SaveWordLyrics saves word-level lyrics as JSON file
func (c *LyricsClient) SaveWordLyrics(lyrics *WordLyricsResponse, outputPath string) error {
	data, err := json.MarshalIndent(lyrics, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal lyrics: %v", err)
	}

	if err := os.WriteFile(outputPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write file: %v", err)
	}

	return nil
}

// DownloadWordLyrics fetches and saves word-level lyrics
func (c *LyricsClient) DownloadWordLyrics(req LyricsDownloadRequest, durationSec int) (*LyricsDownloadResponse, error) {
	if req.SpotifyID == "" {
		return &LyricsDownloadResponse{
			Success: false,
			Error:   "Spotify ID is required",
		}, fmt.Errorf("spotify ID is required")
	}

	outputDir := req.OutputDir
	if outputDir == "" {
		outputDir = GetDefaultMusicPath()
	} else {
		outputDir = NormalizePath(outputDir)
	}

	// Build path to artist/album folder if it exists
	safeArtist := sanitizeFilename(req.AlbumArtist)
	if safeArtist == "" {
		safeArtist = sanitizeFilename(req.ArtistName)
	}
	safeAlbum := sanitizeFilename(req.AlbumName)

	if safeArtist != "" && safeAlbum != "" {
		artistAlbumPath := filepath.Join(outputDir, safeArtist, safeAlbum)
		if info, err := os.Stat(artistAlbumPath); err == nil && info.IsDir() {
			outputDir = artistAlbumPath
		} else {
			artistPath := filepath.Join(outputDir, safeArtist)
			if info, err := os.Stat(artistPath); err == nil && info.IsDir() {
				outputDir = artistPath
			}
		}
	}

	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return &LyricsDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to create output directory: %v", err),
		}, err
	}

	// Build filename with .wordlyrics.json extension
	filenameFormat := req.FilenameFormat
	if filenameFormat == "" {
		filenameFormat = "title-artist"
	}
	baseFilename := buildLyricsFilename(req.TrackName, req.ArtistName, req.AlbumName, req.AlbumArtist, req.ReleaseDate, filenameFormat, req.TrackNumber, req.Position, req.DiscNumber)
	// Replace .lrc with .wordlyrics.json
	filename := strings.TrimSuffix(baseFilename, ".lrc") + ".wordlyrics.json"
	filePath := filepath.Join(outputDir, filename)

	// Check if file already exists
	if fileInfo, err := os.Stat(filePath); err == nil && fileInfo.Size() > 0 {
		return &LyricsDownloadResponse{
			Success:       true,
			Message:       "Word lyrics file already exists",
			File:          filePath,
			AlreadyExists: true,
		}, nil
	}

	// Fetch word-level lyrics
	lyrics, err := c.FetchWordLyrics(req.TrackName, req.ArtistName, req.AlbumName, durationSec)
	if err != nil {
		return &LyricsDownloadResponse{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	// Save as JSON
	if err := c.SaveWordLyrics(lyrics, filePath); err != nil {
		return &LyricsDownloadResponse{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	return &LyricsDownloadResponse{
		Success: true,
		Message: "Word lyrics downloaded successfully",
		File:    filePath,
	}, nil
}

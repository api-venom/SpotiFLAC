package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// StreamingTrack represents a track ready for streaming
type StreamingTrack struct {
	ISRC         string `json:"isrc"`
	SpotifyID    string `json:"spotify_id"`
	Name         string `json:"name"`
	Artists      string `json:"artists"`
	AlbumName    string `json:"album_name"`
	AlbumArtist  string `json:"album_artist"`
	ReleaseDate  string `json:"release_date"`
	Duration     int    `json:"duration_ms"`
	CoverURL     string `json:"cover_url"`
	TrackNumber  int    `json:"track_number"`
	DiscNumber   int    `json:"disc_number"`
	TotalTracks  int    `json:"total_tracks"`
}

// StreamingURLResponse represents the response with streaming URLs
type StreamingURLResponse struct {
	Success      bool              `json:"success"`
	TrackInfo    *StreamingTrack   `json:"track_info,omitempty"`
	TidalURL     string            `json:"tidal_url,omitempty"`
	QobuzURL     string            `json:"qobuz_url,omitempty"`
	AmazonURL    string            `json:"amazon_url,omitempty"`
	PreferredURL string            `json:"preferred_url,omitempty"`
	Quality      string            `json:"quality,omitempty"`
	Error        string            `json:"error,omitempty"`
}

// StreamingLyricsResponse represents the lyrics response for streaming
type StreamingLyricsResponse struct {
	Success      bool          `json:"success"`
	SyncType     string        `json:"sync_type"`
	Lines        []LyricsLine  `json:"lines"`
	LRCContent   string        `json:"lrc_content"`
	Error        string        `json:"error,omitempty"`
}

// GetStreamingURLs gets direct streaming URLs for a track from all available services
func GetStreamingURLs(ctx context.Context, spotifyID, isrc string, track *StreamingTrack, preferredService, quality string) (*StreamingURLResponse, error) {
	response := &StreamingURLResponse{
		Success:   false,
		TrackInfo: track,
		Quality:   quality,
	}

	if quality == "" {
		quality = "LOSSLESS"
	}

	// Try to get URLs from different services
	var tidalURL, qobuzURL, amazonURL string
	var errors []string

	// 1. Try Tidal
	if preferredService == "" || preferredService == "tidal" {
		tidal := NewTidalDownloader("")
		
		// Try to get Tidal track ID from Spotify
		tidalTrackURL, err := tidal.GetTidalURLFromSpotify(spotifyID)
		if err == nil && tidalTrackURL != "" {
			trackID, err := tidal.GetTrackIDFromURL(tidalTrackURL)
			if err == nil {
				downloadURL, err := tidal.GetDownloadURL(trackID, quality)
				if err == nil && downloadURL != "" {
					tidalURL = downloadURL
					response.TidalURL = downloadURL
				} else {
					errors = append(errors, fmt.Sprintf("Tidal: %v", err))
				}
			} else {
				errors = append(errors, fmt.Sprintf("Tidal ID parse: %v", err))
			}
		} else {
			errors = append(errors, fmt.Sprintf("Tidal lookup: %v", err))
		}
	}

	// 2. Try Qobuz
	if (preferredService == "" || preferredService == "qobuz") && isrc != "" {
		qobuz := NewQobuzDownloader()
		
		qobuzTrack, err := qobuz.SearchByISRC(isrc)
		if err == nil && qobuzTrack != nil {
			qobuzQuality := quality
			if quality == "LOSSLESS" {
				qobuzQuality = "6" // 16-bit FLAC
			} else if quality == "HI_RES_LOSSLESS" {
				qobuzQuality = "27" // Hi-Res
			}
			
			downloadURL, err := qobuz.GetDownloadURL(qobuzTrack.ID, qobuzQuality)
			if err == nil && downloadURL != "" {
				qobuzURL = downloadURL
				response.QobuzURL = downloadURL
			} else {
				errors = append(errors, fmt.Sprintf("Qobuz: %v", err))
			}
		} else {
			errors = append(errors, fmt.Sprintf("Qobuz search: %v", err))
		}
	}

	// 3. Try Amazon (if needed)
	// Note: Amazon streaming would require additional implementation

	// Set preferred URL based on priority or availability
	if preferredService == "tidal" && tidalURL != "" {
		response.PreferredURL = tidalURL
		response.Success = true
	} else if preferredService == "qobuz" && qobuzURL != "" {
		response.PreferredURL = qobuzURL
		response.Success = true
	} else if tidalURL != "" {
		response.PreferredURL = tidalURL
		response.Success = true
	} else if qobuzURL != "" {
		response.PreferredURL = qobuzURL
		response.Success = true
	} else if amazonURL != "" {
		response.PreferredURL = amazonURL
		response.Success = true
	}

	if !response.Success {
		response.Error = fmt.Sprintf("No streaming URLs available. Errors: %v", errors)
		return response, fmt.Errorf(response.Error)
	}

	return response, nil
}

// GetStreamingLyrics fetches lyrics for streaming playback
func GetStreamingLyrics(ctx context.Context, spotifyID, trackName, artistName string) (*StreamingLyricsResponse, error) {
	response := &StreamingLyricsResponse{
		Success: false,
	}

	if spotifyID == "" || trackName == "" || artistName == "" {
		response.Error = "Missing required fields"
		return response, fmt.Errorf(response.Error)
	}

	client := NewLyricsClient()
	
	// Try all sources with timeout
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	lyrics, source, err := client.FetchLyricsAllSources(spotifyID, trackName, artistName)
	if err != nil {
		response.Error = fmt.Sprintf("No lyrics found: %v", err)
		return response, err
	}

	if lyrics == nil || len(lyrics.Lines) == 0 {
		response.Error = "No lyrics content found"
		return response, fmt.Errorf(response.Error)
	}

	response.Success = true
	response.SyncType = lyrics.SyncType
	response.Lines = lyrics.Lines
	response.LRCContent = client.ConvertToLRC(lyrics, trackName, artistName)

	fmt.Printf("Lyrics found from %s (%s, %d lines)\n", source, lyrics.SyncType, len(lyrics.Lines))
	
	return response, nil
}
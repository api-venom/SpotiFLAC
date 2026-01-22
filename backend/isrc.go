package backend

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// CheckISRCExists searches downloadDir recursively for a file that appears to match the given ISRC.
//
// It returns the first matching file path and ok=true when found.
//
// Matching strategy:
// - Case-insensitive substring match on filename (without path)
// - Checks common audio extensions
//
// Note: This is a best-effort helper to prefer already-downloaded files for playback.
func CheckISRCExists(downloadDir, isrc string) (path string, ok bool) {
	isrc = strings.ToUpper(strings.TrimSpace(isrc))
	if downloadDir == "" || isrc == "" {
		return "", false
	}

	// Quick check: directory exists.
	st, err := os.Stat(downloadDir)
	if err != nil || !st.IsDir() {
		return "", false
	}

	_ = filepath.WalkDir(downloadDir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			// Ignore unreadable paths.
			return nil
		}
		if d.IsDir() {
			return nil
		}

		name := strings.ToUpper(d.Name())
		if !strings.Contains(name, isrc) {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(d.Name()))
		switch ext {
		case ".flac", ".wav", ".aiff", ".aif", ".alac", ".m4a", ".mp3", ".ogg", ".opus", ".mka":
			path = p
			ok = true
			return errors.New("found")
		default:
			return nil
		}
	})

	if ok {
		return path, true
	}
	return "", false
}

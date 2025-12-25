//go:build cgo && !stub
// +build cgo,!stub

package backend

/*
#cgo CFLAGS: -I${SRCDIR}/mpv
#cgo windows LDFLAGS: -L${SRCDIR} -lmpv
#cgo linux LDFLAGS: -lmpv
#cgo darwin CFLAGS: -I/opt/homebrew/include -I/usr/local/include
#cgo darwin LDFLAGS: -L/opt/homebrew/lib -L/usr/local/lib -lmpv

#include <stdlib.h>
#include <stdint.h>
#include "client.h"
*/
import "C"
import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
	"unsafe"
)

var (
	ErrMPVNotInitialized = errors.New("mpv not initialized")
	ErrMPVAlreadyClosed  = errors.New("mpv already closed")
)

// mpvPlayerImpl is the real libmpv implementation
type mpvPlayerImpl struct {
	mu     sync.Mutex
	handle *C.mpv_handle
	closed bool

	currentURL   string
	currentState string // playing, paused, stopped
	volume       float64

	// Playback state tracking
	positionSec float64
	durationSec float64
	audioCodec  string
	sampleRate  int
	bitDepth    int
	channels    int
	container   string
}

// NewMPVPlayerImpl creates a real MPV player using libmpv
func NewMPVPlayerImpl() (MPVPlayer, error) {
	handle := C.mpv_create()
	if handle == nil {
		return nil, fmt.Errorf("failed to create mpv instance")
	}

	p := &mpvPlayerImpl{
		handle:       handle,
		currentState: "stopped",
		volume:       100.0,
	}

	// Set MPV options for audio-only playback
	if err := p.setOption("vo", "null"); err != nil {
		C.mpv_destroy(handle)
		return nil, fmt.Errorf("failed to set vo=null: %w", err)
	}

	if err := p.setOption("video", "no"); err != nil {
		C.mpv_destroy(handle)
		return nil, fmt.Errorf("failed to disable video: %w", err)
	}

	// Enable terminal output for debugging
	if err := p.setOption("terminal", "yes"); err != nil {
		// Non-critical, continue
	}

	// Set audio driver (try wasapi for Windows, alsa for Linux, coreaudio for Mac)
	if err := p.setOption("audio-device", "auto"); err != nil {
		// Non-critical, continue
	}

	// Initialize MPV
	ret := C.mpv_initialize(handle)
	if ret < 0 {
		C.mpv_destroy(handle)
		return nil, fmt.Errorf("mpv_initialize failed: %s", mpvError(ret))
	}

	// Set initial volume
	if err := p.SetVolume(context.Background(), 100.0); err != nil {
		// Non-critical
	}

	// Start property observation for automatic state updates
	go p.observeProperties()

	return p, nil
}

func (p *mpvPlayerImpl) setOption(name, value string) error {
	cName := C.CString(name)
	defer C.free(unsafe.Pointer(cName))
	cValue := C.CString(value)
	defer C.free(unsafe.Pointer(cValue))

	ret := C.mpv_set_option_string(p.handle, cName, cValue)
	if ret < 0 {
		return fmt.Errorf("mpv_set_option_string(%s, %s) failed: %s", name, value, mpvError(ret))
	}
	return nil
}

func (p *mpvPlayerImpl) Load(ctx context.Context, url string, headers map[string]string) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.closed {
		return ErrMPVAlreadyClosed
	}

	p.currentURL = url
	p.currentState = "stopped"

	// Build command: loadfile <url> replace
	cCmd := C.CString("loadfile")
	cURL := C.CString(url)
	cReplace := C.CString("replace")
	defer func() {
		C.free(unsafe.Pointer(cCmd))
		C.free(unsafe.Pointer(cURL))
		C.free(unsafe.Pointer(cReplace))
	}()

	args := []*C.char{cCmd, cURL, cReplace, nil}
	ret := C.mpv_command(p.handle, &args[0])
	if ret < 0 {
		return fmt.Errorf("mpv_command(loadfile) failed: %s", mpvError(ret))
	}

	return nil
}

func (p *mpvPlayerImpl) Play(ctx context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.closed {
		return ErrMPVAlreadyClosed
	}

	// Set pause=no
	if err := p.setBoolProperty("pause", false); err != nil {
		return err
	}

	p.currentState = "playing"
	return nil
}

func (p *mpvPlayerImpl) Pause(ctx context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.closed {
		return ErrMPVAlreadyClosed
	}

	// Set pause=yes
	if err := p.setBoolProperty("pause", true); err != nil {
		return err
	}

	p.currentState = "paused"
	return nil
}

func (p *mpvPlayerImpl) Stop(ctx context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.closed {
		return ErrMPVAlreadyClosed
	}

	cCmd := C.CString("stop")
	defer C.free(unsafe.Pointer(cCmd))

	args := []*C.char{cCmd, nil}
	ret := C.mpv_command(p.handle, &args[0])
	if ret < 0 {
		return fmt.Errorf("mpv_command(stop) failed: %s", mpvError(ret))
	}

	p.currentState = "stopped"
	p.positionSec = 0
	return nil
}

func (p *mpvPlayerImpl) SeekSeconds(ctx context.Context, seconds float64) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.closed {
		return ErrMPVAlreadyClosed
	}

	// Check if a file is loaded
	if p.currentState == "stopped" || p.durationSec == 0 {
		// File not loaded yet, just update local position
		p.positionSec = seconds
		return nil
	}

	if err := p.setDoubleProperty("time-pos", seconds); err != nil {
		// Property unavailable - file may not be loaded yet
		// Update local position and continue
		p.positionSec = seconds
		return nil
	}

	p.positionSec = seconds
	return nil
}

func (p *mpvPlayerImpl) SetVolume(ctx context.Context, volume float64) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.closed {
		return ErrMPVAlreadyClosed
	}

	// MPV volume is 0-100
	vol := volume
	if vol < 0 {
		vol = 0
	}
	if vol > 100 {
		vol = 100
	}

	if err := p.setDoubleProperty("volume", vol); err != nil {
		return err
	}

	p.volume = vol
	return nil
}

func (p *mpvPlayerImpl) SetEqualizer(ctx context.Context, presetName string, bands map[string]float64, preamp float64) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.closed {
		return ErrMPVAlreadyClosed
	}

	// Build equalizer filter string for MPV
	// MPV uses lavfi/ffmpeg audio filters: af=lavfi=[equalizer=...]
	// 10-band equalizer: 32, 64, 125, 250, 500, 1k, 2k, 4k, 8k, 16k Hz
	//
	// Format: equalizer=f=32:width_type=q:width=1:g=0:f=64:width_type=q:width=1:g=0:...
	
	// Default bands if not provided
	defaultBands := map[string]float64{
		"32":    0,
		"64":    0,
		"125":   0,
		"250":   0,
		"500":   0,
		"1000":  0,
		"2000":  0,
		"4000":  0,
		"8000":  0,
		"16000": 0,
	}
	
	// Merge provided bands with defaults
	for k, v := range bands {
		defaultBands[k] = v
	}
	
	// Build filter string
	filterParts := []string{}
	frequencies := []string{"32", "64", "125", "250", "500", "1000", "2000", "4000", "8000", "16000"}
	
	for _, freq := range frequencies {
		gain := defaultBands[freq]
		// Apply preamp to each band
		totalGain := gain + preamp
		filterParts = append(filterParts, fmt.Sprintf("f=%s:width_type=q:width=1:g=%.1f", freq, totalGain))
	}
	
	eqFilter := "equalizer=" + fmt.Sprintf("%s", filterParts[0])
	for i := 1; i < len(filterParts); i++ {
		eqFilter += ":" + filterParts[i]
	}
	
	// Set audio filter
	cName := C.CString("af")
	defer C.free(unsafe.Pointer(cName))
	cValue := C.CString(eqFilter)
	defer C.free(unsafe.Pointer(cValue))
	
	ret := C.mpv_set_property(p.handle, cName, C.MPV_FORMAT_STRING, unsafe.Pointer(&cValue))
	if ret < 0 {
		return fmt.Errorf("mpv_set_property(af) failed: %s", mpvError(ret))
	}
	
	return nil
}

func (p *mpvPlayerImpl) Status(ctx context.Context) (MPVStatus, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.closed {
		return MPVStatus{}, ErrMPVAlreadyClosed
	}

	// Update properties from MPV
	p.updateProperties()

	return MPVStatus{
		State:       p.currentState,
		PositionSec: p.positionSec,
		DurationSec: p.durationSec,
		Volume:      p.volume,
		CurrentURL:  p.currentURL,
		AudioCodec:  p.audioCodec,
		SampleRate:  p.sampleRate,
		BitDepth:    p.bitDepth,
		Channels:    p.channels,
		Container:   p.container,
		IsHiRes:     p.sampleRate >= 48000 && p.bitDepth >= 24,
	}, nil
}

func (p *mpvPlayerImpl) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.closed {
		return nil
	}

	if p.handle != nil {
		C.mpv_destroy(p.handle)
		p.handle = nil
	}

	p.closed = true
	p.currentState = "stopped"
	return nil
}

// Helper methods

func (p *mpvPlayerImpl) setBoolProperty(name string, value bool) error {
	cName := C.CString(name)
	defer C.free(unsafe.Pointer(cName))

	var val C.int
	if value {
		val = 1
	} else {
		val = 0
	}

	ret := C.mpv_set_property(p.handle, cName, C.MPV_FORMAT_FLAG, unsafe.Pointer(&val))
	if ret < 0 {
		return fmt.Errorf("mpv_set_property(%s) failed: %s", name, mpvError(ret))
	}
	return nil
}

func (p *mpvPlayerImpl) setDoubleProperty(name string, value float64) error {
	cName := C.CString(name)
	defer C.free(unsafe.Pointer(cName))

	cVal := C.double(value)
	ret := C.mpv_set_property(p.handle, cName, C.MPV_FORMAT_DOUBLE, unsafe.Pointer(&cVal))
	if ret < 0 {
		return fmt.Errorf("mpv_set_property(%s) failed: %s", name, mpvError(ret))
	}
	return nil
}

func (p *mpvPlayerImpl) getDoubleProperty(name string) (float64, error) {
	cName := C.CString(name)
	defer C.free(unsafe.Pointer(cName))

	var val C.double
	ret := C.mpv_get_property(p.handle, cName, C.MPV_FORMAT_DOUBLE, unsafe.Pointer(&val))
	if ret < 0 {
		return 0, fmt.Errorf("mpv_get_property(%s) failed: %s", name, mpvError(ret))
	}
	return float64(val), nil
}

func (p *mpvPlayerImpl) getInt64Property(name string) (int64, error) {
	cName := C.CString(name)
	defer C.free(unsafe.Pointer(cName))

	var val C.int64_t
	ret := C.mpv_get_property(p.handle, cName, C.MPV_FORMAT_INT64, unsafe.Pointer(&val))
	if ret < 0 {
		return 0, fmt.Errorf("mpv_get_property(%s) failed: %s", name, mpvError(ret))
	}
	return int64(val), nil
}

func (p *mpvPlayerImpl) getStringProperty(name string) (string, error) {
	cName := C.CString(name)
	defer C.free(unsafe.Pointer(cName))

	var cStr *C.char
	ret := C.mpv_get_property(p.handle, cName, C.MPV_FORMAT_STRING, unsafe.Pointer(&cStr))
	if ret < 0 {
		return "", fmt.Errorf("mpv_get_property(%s) failed: %s", name, mpvError(ret))
	}
	if cStr == nil {
		return "", nil
	}
	defer C.mpv_free(unsafe.Pointer(cStr))
	return C.GoString(cStr), nil
}

func (p *mpvPlayerImpl) updateProperties() {
	// Update position
	if pos, err := p.getDoubleProperty("time-pos"); err == nil {
		p.positionSec = pos
	}

	// Update duration
	if dur, err := p.getDoubleProperty("duration"); err == nil {
		p.durationSec = dur
	}

	// Update pause state
	if paused, err := p.getInt64Property("pause"); err == nil {
		if paused == 1 {
			p.currentState = "paused"
		} else if p.durationSec > 0 {
			p.currentState = "playing"
		}
	}

	// Update audio codec
	if codec, err := p.getStringProperty("audio-codec-name"); err == nil {
		p.audioCodec = codec
	}

	// Update sample rate
	if sr, err := p.getInt64Property("audio-params/samplerate"); err == nil {
		p.sampleRate = int(sr)
	}

	// Update channels
	if ch, err := p.getInt64Property("audio-params/channel-count"); err == nil {
		p.channels = int(ch)
	}

	// Try to get bit depth - this may not always be available
	if bd, err := p.getStringProperty("audio-params/format"); err == nil {
		// Parse format string like "s16", "s24", "s32", "floatp"
		if len(bd) >= 3 && bd[0] == 's' {
			switch bd[1:3] {
			case "16":
				p.bitDepth = 16
			case "24":
				p.bitDepth = 24
			case "32":
				p.bitDepth = 32
			}
		}
	}

	// Container format
	if cont, err := p.getStringProperty("file-format"); err == nil {
		p.container = cont
	}
}

func (p *mpvPlayerImpl) observeProperties() {
	// This runs in a goroutine and polls MPV properties
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		p.mu.Lock()
		if p.closed {
			p.mu.Unlock()
			return
		}
		p.updateProperties()
		p.mu.Unlock()
	}
}

func mpvError(code C.int) string {
	cStr := C.mpv_error_string(code)
	if cStr == nil {
		return fmt.Sprintf("unknown error (%d)", int(code))
	}
	return C.GoString(cStr)
}

package backend

import (
	"context"
	"errors"
	"fmt"
	"sync"
)

// NOTE:
// This is a scaffolding for integrating libmpv (headless audio) into the Wails app.
// The full integration requires CGO bindings to libmpv (mpv-2.dll on Windows)
// and proper packaging of the dll + its dependencies.
//
// We keep an interface so the rest of the app can be wired now, while the actual
// libmpv bridge can be implemented in a follow-up commit once the dll layout is finalized.

var (
	ErrMPVNotImplemented = errors.New("mpv player backend not implemented yet")
)

// MPVPlayer is the backend interface used by the frontend player controller.
// A concrete implementation will wrap libmpv.
//
// Methods should be safe to call from multiple goroutines.
type MPVPlayer interface {
	Load(ctx context.Context, url string, headers map[string]string) error
	Play(ctx context.Context) error
	Pause(ctx context.Context) error
	Stop(ctx context.Context) error
	SeekSeconds(ctx context.Context, seconds float64) error
	SetVolume(ctx context.Context, volume float64) error
	SetEqualizer(ctx context.Context, presetName string, bands map[string]float64, preamp float64) error
	Status(ctx context.Context) (MPVStatus, error)
	Close() error
}

// MPVStatus represents current playback state.
type MPVStatus struct {
	State        string  `json:"state"` // playing, paused, stopped
	PositionSec  float64 `json:"position_sec"`
	DurationSec  float64 `json:"duration_sec"`
	Volume       float64 `json:"volume"`
	CurrentURL   string  `json:"current_url"`
	AudioCodec   string  `json:"audio_codec,omitempty"`
	SampleRate   int     `json:"sample_rate,omitempty"`
	BitDepth     int     `json:"bit_depth,omitempty"`
	Channels     int     `json:"channels,omitempty"`
	Container    string  `json:"container,omitempty"`
	IsHiRes      bool    `json:"is_hires"`
	LastError    string  `json:"last_error,omitempty"`
	BufferingPct float64 `json:"buffering_pct,omitempty"`
}

// mpvPlayerStub lets the rest of the app compile until libmpv integration is finalized.
type mpvPlayerStub struct {
	mu     sync.Mutex
	status MPVStatus
}

func NewMPVPlayer() MPVPlayer {
	return &mpvPlayerStub{status: MPVStatus{State: "stopped", Volume: 100}}
}

func (p *mpvPlayerStub) Load(ctx context.Context, url string, headers map[string]string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.status.CurrentURL = url
	p.status.State = "stopped"
	_ = headers
	return ErrMPVNotImplemented
}

func (p *mpvPlayerStub) Play(ctx context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.status.State = "playing"
	return ErrMPVNotImplemented
}

func (p *mpvPlayerStub) Pause(ctx context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.status.State = "paused"
	return ErrMPVNotImplemented
}

func (p *mpvPlayerStub) Stop(ctx context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.status.State = "stopped"
	return ErrMPVNotImplemented
}

func (p *mpvPlayerStub) SeekSeconds(ctx context.Context, seconds float64) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.status.PositionSec = seconds
	return ErrMPVNotImplemented
}

func (p *mpvPlayerStub) SetVolume(ctx context.Context, volume float64) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.status.Volume = volume
	return ErrMPVNotImplemented
}

func (p *mpvPlayerStub) SetEqualizer(ctx context.Context, presetName string, bands map[string]float64, preamp float64) error {
	_ = presetName
	_ = bands
	_ = preamp
	return ErrMPVNotImplemented
}

func (p *mpvPlayerStub) Status(ctx context.Context) (MPVStatus, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.status, nil
}

func (p *mpvPlayerStub) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.status.State = "stopped"
	return nil
}

// ValidateHiResFLAC is a sanity check helper.
func ValidateHiResFLAC(sampleRate int, bitDepth int) (bool, string) {
	if sampleRate <= 0 {
		return false, "missing sample rate"
	}
	if bitDepth <= 0 {
		return false, "missing bit depth"
	}
	if sampleRate < 48000 {
		return false, fmt.Sprintf("sample rate too low for hi-res: %d", sampleRate)
	}
	if bitDepth < 24 {
		return false, fmt.Sprintf("bit depth too low for hi-res: %d", bitDepth)
	}
	return true, ""
}

//go:build !cgo || stub
// +build !cgo stub

package backend

import (
	"fmt"
)

// mpvPlayerImpl stub for when libmpv is not available
type mpvPlayerImpl struct{}

// NewMPVPlayerImpl returns an error when libmpv is not available
func NewMPVPlayerImpl() (MPVPlayer, error) {
	return nil, fmt.Errorf("libmpv not available - app was built without CGO or libmpv is not installed")
}

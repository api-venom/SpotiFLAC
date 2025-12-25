// +build ignore

package main

import (
	"fmt"
	"spotiflac/backend"
)

func main() {
	player := backend.NewMPVPlayer()
	fmt.Printf("MPV Player type: %T\n", player)
	
	// Try to get status to see if it's the real implementation or stub
	status, err := player.Status(nil)
	if err != nil {
		fmt.Printf("Error getting status: %v\n", err)
	} else {
		fmt.Printf("Status: %+v\n", status)
	}
}

package webui

import "embed"

// Assets contains the Vite production build served by the Go application.
//
//go:embed dist
var Assets embed.FS

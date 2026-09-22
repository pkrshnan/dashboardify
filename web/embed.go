package webui

import "embed"

// Assets contains the Vite production build served by the Go application.
//
//go:embed dist/index.html dist/assets/*
var Assets embed.FS

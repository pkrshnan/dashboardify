package logging

import (
	"io"
	"log/slog"
	"os"
	"strings"
)

func New(levelName string) *slog.Logger {
	return newLogger(os.Stdout, levelName)
}

func newLogger(writer io.Writer, levelName string) *slog.Logger {
	var level slog.Level
	_ = level.UnmarshalText([]byte(levelName))

	handler := slog.NewJSONHandler(writer, &slog.HandlerOptions{
		Level: level,
		ReplaceAttr: func(_ []string, attr slog.Attr) slog.Attr {
			if sensitiveKey(attr.Key) {
				return slog.String(attr.Key, "[REDACTED]")
			}
			return attr
		},
	})
	return slog.New(handler)
}

func sensitiveKey(key string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(key, "-", "_"))
	switch normalized {
	case "authorization", "cookie", "set_cookie", "token", "secret", "password", "body", "capture_text", "note_body", "query":
		return true
	default:
		return false
	}
}

package logging

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestSensitiveAttributesAreRedacted(t *testing.T) {
	var output bytes.Buffer
	logger := newLogger(&output, "info")

	logger.Info("capture.saved",
		"capture_text", "private words",
		"authorization", "Bearer private-token",
		"route", "capture",
	)

	var entry map[string]any
	if err := json.Unmarshal(output.Bytes(), &entry); err != nil {
		t.Fatalf("decode log entry: %v", err)
	}
	if entry["capture_text"] != "[REDACTED]" {
		t.Fatalf("capture_text = %q, want redacted", entry["capture_text"])
	}
	if entry["authorization"] != "[REDACTED]" {
		t.Fatalf("authorization = %q, want redacted", entry["authorization"])
	}
	if entry["route"] != "capture" {
		t.Fatalf("route = %q, want capture", entry["route"])
	}
	if bytes.Contains(output.Bytes(), []byte("private words")) || bytes.Contains(output.Bytes(), []byte("private-token")) {
		t.Fatalf("log contains sensitive value: %s", output.Bytes())
	}
}

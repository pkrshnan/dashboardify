package obsidian

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"dashboardify/internal/capture"
)

func TestWriterGroupsCapturesByLocalDayWithoutDuplicates(t *testing.T) {
	vault := t.TempDir()
	location, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatal(err)
	}
	writer, err := New(vault, "Dashboardify Captures.md", location)
	if err != nil {
		t.Fatal(err)
	}
	records := []capture.Record{
		{ID: "second", RawText: "Second capture", CapturedAt: time.Date(2026, time.October, 1, 2, 15, 0, 0, time.UTC)},
		{ID: "first", RawText: "First capture", CapturedAt: time.Date(2026, time.October, 1, 1, 5, 0, 0, time.UTC)},
		{ID: "next-day", RawText: "A multiline\nnote", CapturedAt: time.Date(2026, time.October, 2, 7, 30, 0, 0, time.UTC)},
	}
	if err := writer.SyncCaptures(context.Background(), records); err != nil {
		t.Fatal(err)
	}
	if err := writer.SyncCaptures(context.Background(), records); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(vault, "Dashboardify Captures.md")
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(content)
	if strings.Count(text, "## 2026-09-30") != 1 || strings.Count(text, "## 2026-10-02") != 1 {
		t.Fatalf("day headings missing or duplicated:\n%s", text)
	}
	if strings.Count(text, "dashboardify-capture:first") != 1 || strings.Count(text, "dashboardify-capture:second") != 1 {
		t.Fatalf("capture markers missing or duplicated:\n%s", text)
	}
	if strings.Index(text, "First capture") > strings.Index(text, "Second capture") {
		t.Fatalf("captures are not chronological:\n%s", text)
	}
	if !strings.Contains(text, "- **00:30** — A multiline\n  note") {
		t.Fatalf("multiline capture not formatted correctly:\n%s", text)
	}
}

func TestWriterPreservesManualContentWhenAddingCapture(t *testing.T) {
	vault := t.TempDir()
	path := filepath.Join(vault, "Inbox.md")
	initial := "# Dashboardify Captures\n\nManual preface.\n\n## 2026-09-30\n\n- A manual item\n"
	if err := os.WriteFile(path, []byte(initial), 0o600); err != nil {
		t.Fatal(err)
	}
	writer, err := New(vault, "Inbox.md", time.UTC)
	if err != nil {
		t.Fatal(err)
	}
	record := capture.Record{
		ID: "new-capture", RawText: "Captured text",
		CapturedAt: time.Date(2026, time.September, 30, 18, 45, 0, 0, time.UTC),
	}
	if err := writer.WriteCapture(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(content)
	if !strings.Contains(text, "Manual preface.") || !strings.Contains(text, "- A manual item") ||
		!strings.Contains(text, "- **18:45** — Captured text") {
		t.Fatalf("manual content was not preserved:\n%s", text)
	}
}

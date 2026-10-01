package obsidian

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"dashboardify/internal/capture"
)

const noteHeader = "# Dashboardify Captures\n"

type Writer struct {
	path     string
	location *time.Location
	mutex    sync.Mutex
}

func New(vaultPath, captureFile string, location *time.Location) (*Writer, error) {
	if location == nil {
		return nil, errors.New("Obsidian capture timezone is required")
	}
	info, err := os.Stat(vaultPath)
	if err != nil || !info.IsDir() {
		return nil, errors.New("Obsidian vault must be an existing directory")
	}
	if filepath.Base(captureFile) != captureFile || filepath.Ext(captureFile) != ".md" {
		return nil, errors.New("Obsidian capture file must be a top-level Markdown filename")
	}
	return &Writer{path: filepath.Join(vaultPath, captureFile), location: location}, nil
}

func (writer *Writer) SyncCaptures(ctx context.Context, records []capture.Record) error {
	writer.mutex.Lock()
	defer writer.mutex.Unlock()

	content, err := writer.readNote()
	if err != nil {
		return err
	}
	ordered := append([]capture.Record(nil), records...)
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].CapturedAt.Equal(ordered[j].CapturedAt) {
			return ordered[i].ID < ordered[j].ID
		}
		return ordered[i].CapturedAt.Before(ordered[j].CapturedAt)
	})
	changed := false
	for _, record := range ordered {
		if err := ctx.Err(); err != nil {
			return err
		}
		var added bool
		content, added = writer.addCapture(content, record)
		changed = changed || added
	}
	if !changed {
		return nil
	}
	return writer.writeNote(content)
}

func (writer *Writer) WriteCapture(ctx context.Context, record capture.Record) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	writer.mutex.Lock()
	defer writer.mutex.Unlock()

	content, err := writer.readNote()
	if err != nil {
		return err
	}
	content, added := writer.addCapture(content, record)
	if !added {
		return nil
	}
	return writer.writeNote(content)
}

func (writer *Writer) readNote() (string, error) {
	content, err := os.ReadFile(writer.path)
	if errors.Is(err, os.ErrNotExist) {
		return noteHeader, nil
	}
	if err != nil {
		return "", fmt.Errorf("read Obsidian capture note: %w", err)
	}
	return string(content), nil
}

func (writer *Writer) addCapture(content string, record capture.Record) (string, bool) {
	marker := fmt.Sprintf("<!-- dashboardify-capture:%s -->", record.ID)
	if strings.Contains(content, marker) {
		return content, false
	}
	local := record.CapturedAt.In(writer.location)
	heading := "## " + local.Format(time.DateOnly)
	entry := formatEntry(local, record.RawText, marker)

	headingOffset := findHeading(content, heading)
	if headingOffset < 0 {
		content = strings.TrimRight(content, "\n") + "\n\n" + heading + "\n\n" + entry
		return content, true
	}
	sectionStart := headingOffset + len(heading)
	nextHeading := strings.Index(content[sectionStart:], "\n## ")
	insertAt := len(content)
	if nextHeading >= 0 {
		insertAt = sectionStart + nextHeading
	}
	before := strings.TrimRight(content[:insertAt], "\n")
	after := content[insertAt:]
	return before + "\n" + entry + after, true
}

func findHeading(content, heading string) int {
	if strings.HasPrefix(content, heading+"\n") || content == heading {
		return 0
	}
	index := strings.Index(content, "\n"+heading+"\n")
	if index < 0 {
		return -1
	}
	return index + 1
}

func formatEntry(capturedAt time.Time, rawText, marker string) string {
	rawText = strings.ReplaceAll(rawText, "\r\n", "\n")
	lines := strings.Split(rawText, "\n")
	var builder strings.Builder
	fmt.Fprintf(&builder, "- **%s** — %s\n", capturedAt.Format("15:04"), lines[0])
	for _, line := range lines[1:] {
		fmt.Fprintf(&builder, "  %s\n", line)
	}
	fmt.Fprintf(&builder, "  %s\n", marker)
	return builder.String()
}

func (writer *Writer) writeNote(content string) error {
	temporary, err := os.CreateTemp(filepath.Dir(writer.path), ".dashboardify-captures-*.tmp")
	if err != nil {
		return fmt.Errorf("create Obsidian capture note: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("secure Obsidian capture note: %w", err)
	}
	if _, err := temporary.WriteString(strings.TrimRight(content, "\n") + "\n"); err != nil {
		temporary.Close()
		return fmt.Errorf("write Obsidian capture note: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync Obsidian capture note: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close Obsidian capture note: %w", err)
	}
	if err := os.Rename(temporaryPath, writer.path); err != nil {
		return fmt.Errorf("replace Obsidian capture note: %w", err)
	}
	return nil
}

package storage

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"fingeist/internal/domain"
)

func sampleTxns() []domain.Transaction {
	return []domain.Transaction{{ID: "a", Time: time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC), Amount: -150}}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func backupNames(t *testing.T, path string) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(filepath.Dir(path), "backups"))
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

func TestSaveNewFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "transactions.csv")
	hash, err := Save(path, sampleTxns(), 2, "", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	want := csvHeaderV2 + "a,2026-01-02T00:00:00Z,-1.50,,,,,\n"
	if got := readFile(t, path); got != want {
		t.Fatalf("file = %q, want %q", got, want)
	}
	if onDisk, _ := FileHash(path); onDisk != hash {
		t.Fatal("returned hash does not match the file")
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(path), "backups")); err == nil {
		t.Fatal("a new file has nothing to back up")
	}
}

func TestSaveBacksUpPreviousContent(t *testing.T) {
	original := csvHeader + "old,2026-01-01,-9.00,,,,\r\n"
	path := writeCSV(t, original)
	hash, _ := FileHash(path)

	now := time.Date(2026, 3, 4, 5, 6, 7, 8, time.UTC)
	if _, err := Save(path, sampleTxns(), 2, hash, now); err != nil {
		t.Fatal(err)
	}

	names := backupNames(t, path)
	if len(names) != 1 || names[0] != "transactions-20260304T050607.000000008Z.csv" {
		t.Fatalf("backups = %v", names)
	}
	if got := readFile(t, filepath.Join(filepath.Dir(path), "backups", names[0])); got != original {
		t.Fatalf("backup = %q, want the original bytes %q", got, original)
	}
	if strings.Contains(readFile(t, path), "\r") {
		t.Fatal("saved file must use LF")
	}
}

func TestSaveKeepsNewestTwentyBackups(t *testing.T) {
	path := writeCSV(t, csvHeader)
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	hash, _ := FileHash(path)

	var err error
	for i := 0; i < 25; i++ {
		hash, err = Save(path, sampleTxns(), 2, hash, start.Add(time.Duration(i)*11*time.Minute))
		if err != nil {
			t.Fatal(err)
		}
	}

	names := backupNames(t, path)
	if len(names) != 20 {
		t.Fatalf("kept %d backups, want 20", len(names))
	}
	if want := "transactions-20260101T005500.000000000Z.csv"; names[0] != want {
		t.Fatalf("oldest kept = %s, want %s", names[0], want)
	}
	if want := "transactions-20260101T042400.000000000Z.csv"; names[19] != want {
		t.Fatalf("newest = %s, want %s", names[19], want)
	}
}

func TestSaveDetectsExternalChange(t *testing.T) {
	path := writeCSV(t, csvHeader)
	hash, _ := FileHash(path)

	edited := csvHeader + "x,2026-01-01,-1.00,,,,\n"
	if err := os.WriteFile(path, []byte(edited), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := Save(path, sampleTxns(), 2, hash, time.Now()); !errors.Is(err, ErrExternalChange) {
		t.Fatalf("error = %v, want ErrExternalChange", err)
	}
	if got := readFile(t, path); got != edited {
		t.Fatal("the externally edited file must not be touched")
	}
}

func TestSaveDetectsFileCreatedAfterLoad(t *testing.T) {
	path := writeCSV(t, csvHeader)
	if _, err := Save(path, sampleTxns(), 2, "", time.Now()); !errors.Is(err, ErrExternalChange) {
		t.Fatalf("error = %v, want ErrExternalChange", err)
	}
}

func TestSaveDetectsDeletedFile(t *testing.T) {
	path := writeCSV(t, csvHeader)
	hash, _ := FileHash(path)
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if _, err := Save(path, sampleTxns(), 2, hash, time.Now()); !errors.Is(err, ErrExternalChange) {
		t.Fatalf("error = %v, want ErrExternalChange", err)
	}
}

func TestWriteAtomicFailuresLeaveOriginalAndNoTempFiles(t *testing.T) {
	t.Run("missing folder", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "missing", "transactions.csv")
		if err := writeAtomic(path, []byte("x")); err == nil {
			t.Fatal("expected an error")
		}
	})

	t.Run("rename blocked by a folder in the way", func(t *testing.T) {
		dir := t.TempDir()
		path := filepath.Join(dir, "transactions.csv")
		if err := os.Mkdir(path, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(path, "keep"), []byte("keep"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := writeAtomic(path, []byte("new")); err == nil {
			t.Fatal("expected an error")
		}
		if got := readFile(t, filepath.Join(path, "keep")); got != "keep" {
			t.Fatal("existing content was damaged")
		}
		entries, _ := os.ReadDir(dir)
		if len(entries) != 1 {
			t.Fatalf("temp file left behind: %v", entries)
		}
	})
}

func TestSaveFailureLeavesOriginalIntact(t *testing.T) {
	original := csvHeader + "old,2026-01-01,-9.00,,,,\n"
	path := writeCSV(t, original)
	hash, _ := FileHash(path)

	dir := filepath.Dir(path)
	if err := os.Mkdir(filepath.Join(dir, "backups"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(filepath.Join(dir, "backups"), 0o500); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(filepath.Join(dir, "backups"), 0o755)
	if os.Geteuid() == 0 {
		t.Skip("permissions are not enforced for root")
	}

	if _, err := Save(path, sampleTxns(), 2, hash, time.Now()); err == nil {
		t.Fatal("expected the backup failure to stop the save")
	}
	if got := readFile(t, path); got != original {
		t.Fatal("original file must be untouched when the backup fails")
	}
}

func TestSaveFileBacksUpWithTheFilesOwnExtension(t *testing.T) {
	path := filepath.Join(t.TempDir(), "project.toml")
	hash, err := SaveFile(path, []byte("a = 1\n"), "", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	if _, err := SaveFile(path, []byte("a = 2\n"), hash, now); err != nil {
		t.Fatal(err)
	}
	names := backupNames(t, path)
	if len(names) != 1 || names[0] != "project-20260102T030405.000000000Z.toml" {
		t.Fatalf("backups = %v", names)
	}
	if _, err := SaveFile(path, []byte("a = 3\n"), "stale", now); !errors.Is(err, ErrExternalChange) {
		t.Fatalf("error = %v, want ErrExternalChange", err)
	}
}

func TestSaveTakesAtMostOneBackupPerInterval(t *testing.T) {
	path := writeCSV(t, csvHeader)
	start := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	hash, _ := FileHash(path)

	steps := []struct {
		after       time.Duration
		wantBackups int
	}{
		{0, 1},
		{2 * time.Minute, 1},
		{9*time.Minute + 59*time.Second, 1},
		{10 * time.Minute, 2},
		{12 * time.Minute, 2},
		{25 * time.Minute, 3},
	}
	for _, step := range steps {
		var err error
		if hash, err = Save(path, sampleTxns(), 2, hash, start.Add(step.after)); err != nil {
			t.Fatal(err)
		}
		if got := len(backupNames(t, path)); got != step.wantBackups {
			t.Fatalf("after %v: %d backups, want %d", step.after, got, step.wantBackups)
		}
	}
}

func TestSaveBackupIntervalIgnoresOtherFilesAndClockGoingBackwards(t *testing.T) {
	dir := t.TempDir()
	toml := filepath.Join(dir, "project.toml")
	csv := filepath.Join(dir, "transactions.csv")
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	countOf := func(prefix string) int {
		n := 0
		for _, name := range backupNames(t, toml) {
			if strings.HasPrefix(name, prefix) {
				n++
			}
		}
		return n
	}

	hashToml, _ := SaveFile(toml, []byte("a = 1\n"), "", now)
	hashCSV, _ := SaveFile(csv, []byte(csvHeader), "", now)
	if _, err := SaveFile(csv, []byte(csvHeader+"x\n"), hashCSV, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, err := SaveFile(toml, []byte("a = 2\n"), hashToml, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if countOf("project-") != 1 || countOf("transactions-") != 1 {
		t.Fatalf("each file has its own backup history: %v", backupNames(t, toml))
	}

	hashToml, _ = FileHash(toml)
	if _, err := SaveFile(toml, []byte("a = 3\n"), hashToml, now.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	if countOf("project-") != 2 {
		t.Fatalf("a clock set back must not suppress backups: %v", backupNames(t, toml))
	}
}

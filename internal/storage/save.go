package storage

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"time"

	"el-costas/internal/domain"
)

const backupsToKeep = 20

// ErrExternalChange means the file on disk is not the one that was loaded.
var ErrExternalChange = errors.New("transactions file changed on disk")

// Save writes the transactions atomically after backing up the old file. expectedHash is
// the hash from the last load or save; if the file no longer matches, nothing is written.
func Save(path string, txns []domain.Transaction, decimals int, expectedHash string, now time.Time) (string, error) {
	current, err := os.ReadFile(path)
	exists := err == nil
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return "", fmt.Errorf("read %s: %w", path, err)
	}
	currentHash := ""
	if exists {
		currentHash = hashOf(current)
	}
	if currentHash != expectedHash {
		return "", ErrExternalChange
	}

	data, err := encode(txns, decimals)
	if err != nil {
		return "", fmt.Errorf("encode transactions: %w", err)
	}
	if exists {
		if err := backup(path, current, now); err != nil {
			return "", err
		}
	}
	if err := writeAtomic(path, data); err != nil {
		return "", err
	}
	return hashOf(data), nil
}

func backup(path string, content []byte, now time.Time) error {
	dir := filepath.Join(filepath.Dir(path), "backups")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create backups folder: %w", err)
	}

	stem := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)) + "-"
	name := stem + now.UTC().Format("20060102T150405.000000000Z") + ".csv"
	if err := os.WriteFile(filepath.Join(dir, name), content, 0o600); err != nil {
		return fmt.Errorf("write backup: %w", err)
	}
	return pruneBackups(dir, stem)
}

func pruneBackups(dir, stem string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("list backups: %w", err)
	}
	var names []string
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), stem) && strings.HasSuffix(entry.Name(), ".csv") {
			names = append(names, entry.Name())
		}
	}
	slices.Sort(names)

	for len(names) > backupsToKeep {
		if err := os.Remove(filepath.Join(dir, names[0])); err != nil {
			return fmt.Errorf("remove old backup: %w", err)
		}
		names = names[1:]
	}
	return nil
}

func writeAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".save-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	fail := func(err error) error {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}

	if _, err := tmp.Write(data); err != nil {
		return fail(fmt.Errorf("write temp file: %w", err))
	}
	if err := tmp.Sync(); err != nil {
		return fail(fmt.Errorf("sync temp file: %w", err))
	}
	if err := tmp.Close(); err != nil {
		return fail(fmt.Errorf("close temp file: %w", err))
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return fail(fmt.Errorf("replace %s (is another program holding it open?): %w", path, err))
	}
	if runtime.GOOS == "windows" {
		return nil
	}
	return syncDir(dir)
}

func syncDir(dir string) error {
	d, err := os.Open(dir)
	if err != nil {
		return fmt.Errorf("open folder to sync: %w", err)
	}
	defer d.Close()
	if err := d.Sync(); err != nil {
		return fmt.Errorf("sync folder: %w", err)
	}
	return nil
}

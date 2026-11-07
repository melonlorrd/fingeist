package storage

import (
	"bytes"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"slices"
	"time"
)

var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

// Problem is a row that could not be read.
type Problem struct {
	Line    int    `json:"line"`
	Message string `json:"message"`
}

// format describes one CSV file: every header version ever written (oldest first) and how to read and write rows.
type format[T any] struct {
	headers [][]string
	decode  func(version int, record []string) (T, error)
	encode  func(T) []string
	id      func(*T) *string
}

type table[T any] struct {
	items    []T
	problems []Problem
	hash     string
}

// readTable loads a CSV file. A missing file is an empty table with an empty hash.
func readTable[T any](path string, f format[T]) (table[T], error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return table[T]{}, nil
	}
	if err != nil {
		return table[T]{}, fmt.Errorf("read %s: %w", path, err)
	}

	loaded, err := parseTable(data, f)
	if err != nil {
		return table[T]{}, fmt.Errorf("read %s: %w", path, err)
	}
	loaded.hash = hashOf(data)
	return loaded, nil
}

func parseTable[T any](data []byte, f format[T]) (table[T], error) {
	data = bytes.TrimPrefix(data, utf8BOM)
	if len(bytes.TrimSpace(data)) == 0 {
		return table[T]{}, nil
	}

	reader := csv.NewReader(bytes.NewReader(data))
	reader.FieldsPerRecord = -1

	first, err := reader.Read()
	if err != nil {
		return table[T]{}, fmt.Errorf("read header: %w", err)
	}
	version := slices.IndexFunc(f.headers, func(h []string) bool { return slices.Equal(h, first) })
	if version < 0 {
		return table[T]{}, fmt.Errorf("unexpected header %q, want %q", first, f.headers[len(f.headers)-1])
	}

	var loaded table[T]
	seen := map[string]bool{}
	for {
		record, err := reader.Read()
		if errors.Is(err, io.EOF) {
			return loaded, nil
		}
		var parseErr *csv.ParseError
		if errors.As(err, &parseErr) {
			loaded.problems = append(loaded.problems, Problem{Line: parseErr.StartLine, Message: parseErr.Err.Error()})
			continue
		}
		if err != nil {
			return table[T]{}, err
		}

		line, _ := reader.FieldPos(0)
		item, err := decodeRecord(f, version, record)
		if err == nil {
			if id := *f.id(&item); id != "" && seen[id] {
				err = fmt.Errorf("duplicate id %q", id)
			}
		}
		if err != nil {
			loaded.problems = append(loaded.problems, Problem{Line: line, Message: err.Error()})
			continue
		}

		id := f.id(&item)
		if *id == "" {
			*id = NewID()
		}
		seen[*id] = true
		loaded.items = append(loaded.items, item)
	}
}

func decodeRecord[T any](f format[T], version int, record []string) (T, error) {
	if want := len(f.headers[version]); len(record) != want {
		var zero T
		return zero, fmt.Errorf("expected %d fields, got %d", want, len(record))
	}
	return f.decode(version, record)
}

func encodeTable[T any](items []T, f format[T]) ([]byte, error) {
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	if err := writer.Write(f.headers[len(f.headers)-1]); err != nil {
		return nil, err
	}
	for _, item := range items {
		if err := writer.Write(f.encode(item)); err != nil {
			return nil, err
		}
	}
	writer.Flush()
	return buf.Bytes(), writer.Error()
}

func saveTable[T any](path string, items []T, f format[T], expectedHash string, now time.Time) (string, error) {
	data, err := encodeTable(items, f)
	if err != nil {
		return "", fmt.Errorf("encode %s: %w", path, err)
	}
	return SaveFile(path, data, expectedHash, now)
}

// FileHash returns the content hash of the file, or "" if it does not exist.
func FileHash(path string) (string, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("read %s: %w", path, err)
	}
	return hashOf(data), nil
}

func hashOf(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

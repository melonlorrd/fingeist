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

	"el-costas/internal/domain"
)

var header = []string{"id", "time", "amount", "category", "merchant", "note", "tags"}

var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

// Problem is a row that could not be read.
type Problem struct {
	Line    int    `json:"line"`
	Message string `json:"message"`
}

// Loaded is the content of a transactions file. Hash is empty when the file does not exist.
type Loaded struct {
	Transactions []domain.Transaction
	Problems     []Problem
	Hash         string
}

// Load reads a transactions file. A missing file is an empty project.
func Load(path string, decimals int, loc *time.Location) (Loaded, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return Loaded{}, nil
	}
	if err != nil {
		return Loaded{}, fmt.Errorf("read %s: %w", path, err)
	}

	loaded, err := parse(data, decimals, loc)
	if err != nil {
		return Loaded{}, fmt.Errorf("read %s: %w", path, err)
	}
	loaded.Hash = hashOf(data)
	return loaded, nil
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

func parse(data []byte, decimals int, loc *time.Location) (Loaded, error) {
	data = bytes.TrimPrefix(data, utf8BOM)
	if len(bytes.TrimSpace(data)) == 0 {
		return Loaded{}, nil
	}

	reader := csv.NewReader(bytes.NewReader(data))
	reader.FieldsPerRecord = -1

	first, err := reader.Read()
	if err != nil {
		return Loaded{}, fmt.Errorf("read header: %w", err)
	}
	if !slices.Equal(first, header) {
		return Loaded{}, fmt.Errorf("unexpected header %q, want %q", first, header)
	}

	var loaded Loaded
	seen := map[string]bool{}
	for {
		record, err := reader.Read()
		if errors.Is(err, io.EOF) {
			return loaded, nil
		}
		var parseErr *csv.ParseError
		if errors.As(err, &parseErr) {
			loaded.Problems = append(loaded.Problems, Problem{Line: parseErr.StartLine, Message: parseErr.Err.Error()})
			continue
		}
		if err != nil {
			return Loaded{}, err
		}

		line, _ := reader.FieldPos(0)
		txn, err := rowToTransaction(record, decimals, loc)
		if err == nil && txn.ID != "" && seen[txn.ID] {
			err = fmt.Errorf("duplicate id %q", txn.ID)
		}
		if err != nil {
			loaded.Problems = append(loaded.Problems, Problem{Line: line, Message: err.Error()})
			continue
		}
		if txn.ID == "" {
			txn.ID = NewID()
		}
		seen[txn.ID] = true
		loaded.Transactions = append(loaded.Transactions, txn)
	}
}

func rowToTransaction(record []string, decimals int, loc *time.Location) (domain.Transaction, error) {
	if len(record) != len(header) {
		return domain.Transaction{}, fmt.Errorf("expected %d fields, got %d", len(header), len(record))
	}
	return Fields{
		ID: record[0], Time: record[1], Amount: record[2], Category: record[3],
		Merchant: record[4], Note: record[5], Tags: record[6],
	}.toTransaction(decimals, loc)
}

func encode(txns []domain.Transaction, decimals int) ([]byte, error) {
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	if err := writer.Write(header); err != nil {
		return nil, err
	}
	for _, t := range txns {
		f := fieldsOf(t, decimals)
		if err := writer.Write([]string{f.ID, f.Time, f.Amount, f.Category, f.Merchant, f.Note, f.Tags}); err != nil {
			return nil, err
		}
	}
	writer.Flush()
	return buf.Bytes(), writer.Error()
}

func hashOf(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

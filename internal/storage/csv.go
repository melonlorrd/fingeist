package storage

import (
	"time"

	"el-costas/internal/domain"
)

// Loaded is the content of a transactions file. Hash is empty when the file does not exist.
type Loaded struct {
	Transactions []domain.Transaction
	Problems     []Problem
	Hash         string
}

// Load reads a transactions file. A missing file is an empty project.
func Load(path string, decimals int, loc *time.Location) (Loaded, error) {
	loaded, err := readTable(path, transactionFormat(decimals, loc))
	if err != nil {
		return Loaded{}, err
	}
	return Loaded{Transactions: loaded.items, Problems: loaded.problems, Hash: loaded.hash}, nil
}

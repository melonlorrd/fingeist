package storage

import (
	"errors"
	"fmt"
	"slices"
	"time"

	"el-costas/internal/domain"
)

var (
	ErrMalformedRows = errors.New("the transactions file has malformed rows; fix them in the file first")
	ErrNotFound      = errors.New("transaction not found")
)

// Ledger holds one project's transactions in memory and keeps the CSV file in step.
type Ledger struct {
	path     string
	decimals int
	loc      *time.Location
	now      func() time.Time

	txns     []domain.Transaction
	problems []Problem
	hash     string
	unsaved  bool
}

// OpenLedger loads the file. Date-only and local-time inputs are read in loc.
func OpenLedger(path string, decimals int, loc *time.Location) (*Ledger, error) {
	l := &Ledger{path: path, decimals: decimals, loc: loc, now: time.Now}
	if err := l.reload(); err != nil {
		return nil, err
	}
	return l, nil
}

// Transactions returns a copy of the loaded transactions.
func (l *Ledger) Transactions() []domain.Transaction {
	return slices.Clone(l.txns)
}

// Rows returns all transactions as text, newest first.
func (l *Ledger) Rows() []Fields {
	return Rows(l.txns, l.decimals)
}

// Problems lists the rows that could not be read.
func (l *Ledger) Problems() []Problem {
	return l.problems
}

// Unsaved reports that the last save failed and memory is ahead of the file.
func (l *Ledger) Unsaved() bool {
	return l.unsaved
}

// Add appends a transaction under a new id and saves.
func (l *Ledger) Add(f Fields) (Fields, error) {
	if err := l.checkEditable(); err != nil {
		return Fields{}, err
	}
	f.ID = NewID()
	txn, err := f.toTransaction(l.decimals, l.loc)
	if err != nil {
		return Fields{}, err
	}
	l.txns = append(l.txns, txn)
	return fieldsOf(txn, l.decimals), l.save()
}

// Update replaces the transaction with the same id and saves.
func (l *Ledger) Update(f Fields) error {
	if err := l.checkEditable(); err != nil {
		return err
	}
	i := l.indexOf(f.ID)
	if i < 0 {
		return ErrNotFound
	}
	txn, err := f.toTransaction(l.decimals, l.loc)
	if err != nil {
		return err
	}
	l.txns[i] = txn
	return l.save()
}

// Delete removes the transaction with the given id and saves.
func (l *Ledger) Delete(id string) error {
	if err := l.checkEditable(); err != nil {
		return err
	}
	i := l.indexOf(id)
	if i < 0 {
		return ErrNotFound
	}
	l.txns = slices.Delete(l.txns, i, i+1)
	return l.save()
}

// Save retries writing the in-memory transactions.
func (l *Ledger) Save() error {
	if err := l.checkEditable(); err != nil {
		return err
	}
	return l.save()
}

// CheckExternalChange reloads the file if it changed on disk and reports whether it did.
func (l *Ledger) CheckExternalChange() (bool, error) {
	hash, err := FileHash(l.path)
	if err != nil {
		return false, err
	}
	if hash == l.hash {
		return false, nil
	}
	return true, l.reload()
}

func (l *Ledger) checkEditable() error {
	if len(l.problems) > 0 {
		return ErrMalformedRows
	}
	return nil
}

func (l *Ledger) indexOf(id string) int {
	return slices.IndexFunc(l.txns, func(t domain.Transaction) bool { return t.ID == id })
}

func (l *Ledger) reload() error {
	loaded, err := Load(l.path, l.decimals, l.loc)
	if err != nil {
		return err
	}
	l.txns, l.problems, l.hash, l.unsaved = loaded.Transactions, loaded.Problems, loaded.Hash, false
	return nil
}

func (l *Ledger) save() error {
	hash, err := Save(l.path, l.txns, l.decimals, l.hash, l.now())
	if errors.Is(err, ErrExternalChange) {
		if reloadErr := l.reload(); reloadErr != nil {
			return reloadErr
		}
		return fmt.Errorf("%w; it was reloaded and your last change was not saved", err)
	}
	if err != nil {
		l.unsaved = true
		return err
	}
	l.hash, l.unsaved = hash, false
	return nil
}

// Rows formats transactions as text, newest first.
func Rows(txns []domain.Transaction, decimals int) []Fields {
	sorted := slices.Clone(txns)
	slices.SortStableFunc(sorted, func(a, b domain.Transaction) int {
		return b.Time.Compare(a.Time)
	})
	rows := make([]Fields, len(sorted))
	for i, t := range sorted {
		rows[i] = fieldsOf(t, decimals)
	}
	return rows
}

package storage

import (
	"slices"
	"time"

	"el-costas/internal/domain"
)

// Ledger holds one project's transactions in memory and keeps the CSV file in step.
type Ledger struct {
	*store[domain.Transaction]
	decimals int
	loc      *time.Location
}

// OpenLedger loads the file. Date-only and local-time inputs are read in loc.
func OpenLedger(path string, decimals int, loc *time.Location) (*Ledger, error) {
	s, err := openStore(path, transactionFormat(decimals, loc))
	if err != nil {
		return nil, err
	}
	return &Ledger{store: s, decimals: decimals, loc: loc}, nil
}

// Transactions returns a copy of the loaded transactions.
func (l *Ledger) Transactions() []domain.Transaction {
	return slices.Clone(l.items)
}

// Balance is the sum of all transactions.
func (l *Ledger) Balance() domain.Money {
	var balance domain.Money
	for _, t := range l.items {
		balance += t.Amount
	}
	return balance
}

// Rows returns all transactions as text, newest first.
func (l *Ledger) Rows() []Fields {
	return Rows(l.items, l.decimals)
}

// Get returns one transaction as text.
func (l *Ledger) Get(id string) (Fields, error) {
	txn, ok := l.find(id)
	if !ok {
		return Fields{}, ErrNotFound
	}
	return fieldsOf(txn, l.decimals), nil
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
	return fieldsOf(txn, l.decimals), l.append(txn)
}

// Update replaces the transaction with the same id and saves.
func (l *Ledger) Update(f Fields) error {
	if err := l.checkEditable(); err != nil {
		return err
	}
	txn, err := f.toTransaction(l.decimals, l.loc)
	if err != nil {
		return err
	}
	return l.replace(txn.ID, txn)
}

// Delete removes the transaction with the given id and saves.
func (l *Ledger) Delete(id string) error {
	return l.remove(id)
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

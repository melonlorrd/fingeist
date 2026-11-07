package domain

import "time"

// DateLayout is the layout of calendar dates in files, filters and buckets.
const DateLayout = "2006-01-02"

type Intent string

const (
	IntentNone    Intent = ""
	IntentNeed    Intent = "need"
	IntentWant    Intent = "want"
	IntentImpulse Intent = "impulse"
)

// Valid reports whether the intent is blank or one of the three known values.
func (i Intent) Valid() bool {
	switch i {
	case IntentNone, IntentNeed, IntentWant, IntentImpulse:
		return true
	}
	return false
}

// Transaction is one row of transactions.csv. Time keeps the offset it was recorded with;
// when TimeUnknown is set, only its date is meaningful.
type Transaction struct {
	ID          string
	Time        time.Time
	TimeUnknown bool
	Amount      Money
	Category    string
	Merchant    string
	Note        string
	Tags        []string
	Intent      Intent
}

func (t Transaction) IsExpense() bool {
	return t.Amount < 0
}

// Date is the wall-clock date in the row's own offset.
func (t Transaction) Date() string {
	return t.Time.Format(DateLayout)
}

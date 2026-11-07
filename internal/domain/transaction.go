package domain

import "time"

// Transaction is one row of transactions.csv. Time keeps the offset it was recorded with.
type Transaction struct {
	ID       string
	Time     time.Time
	Amount   Money
	Category string
	Merchant string
	Note     string
	Tags     []string
}

package report

import (
	"fmt"
	"time"

	"fingeist/internal/domain"
)

// Scope is the date range a view covers. From and To are inclusive dates, either may be empty;
// Today is the current local date and marks where "the future" begins.
type Scope struct {
	From  string
	To    string
	Today string
}

// Validate checks the dates are YYYY-MM-DD and in order.
func (s Scope) Validate() error {
	for _, date := range []string{s.From, s.To} {
		if _, err := time.Parse(domain.DateLayout, date); date != "" && err != nil {
			return fmt.Errorf("invalid date %q: use YYYY-MM-DD", date)
		}
	}
	if s.From != "" && s.To != "" && s.From > s.To {
		return fmt.Errorf("the start date %s is after the end date %s", s.From, s.To)
	}
	return nil
}

// Filter keeps transactions whose own wall-clock date is within the range.
func (s Scope) Filter(txns []domain.Transaction) []domain.Transaction {
	kept := []domain.Transaction{}
	for _, t := range txns {
		if s.contains(t.Date()) {
			kept = append(kept, t)
		}
	}
	return kept
}

func (s Scope) contains(date string) bool {
	return (s.From == "" || date >= s.From) && (s.To == "" || date <= s.To)
}

// bounds resolves open ends: the first transaction opens the range, today (else the last transaction) closes it.
func (s Scope) bounds(all []domain.Transaction) (start, end string, ok bool) {
	first, last := "", ""
	for _, t := range all {
		date := t.Date()
		if first == "" || date < first {
			first = date
		}
		if date > last {
			last = date
		}
	}

	start, end = s.From, s.To
	if start == "" {
		start = first
	}
	if end == "" {
		end = s.Today
	}
	if end == "" {
		end = last
	}
	return start, end, start != "" && end != "" && start <= end
}

// pastBounds is bounds with the end held back to today, since future days have no spending yet.
func (s Scope) pastBounds(all []domain.Transaction) (start, end string, ok bool) {
	start, end, ok = s.bounds(all)
	if ok && s.Today != "" && end > s.Today {
		end = s.Today
	}
	return start, end, ok && start <= end
}

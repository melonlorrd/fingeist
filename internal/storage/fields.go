package storage

import (
	"fmt"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"

	"el-costas/internal/domain"
)

// Fields is a transaction as text, the same shape as a CSV row and as the edit form.
type Fields struct {
	ID       string `json:"id"`
	Time     string `json:"time"`
	Amount   string `json:"amount"`
	Category string `json:"category"`
	Merchant string `json:"merchant"`
	Note     string `json:"note"`
	Tags     string `json:"tags"`
	Intent   string `json:"intent"`
}

var transactionHeaders = [][]string{
	{"id", "time", "amount", "category", "merchant", "note", "tags"},
	{"id", "time", "amount", "category", "merchant", "note", "tags", "intent"},
}

var localTimeLayouts = []string{
	"2006-01-02T15:04:05",
	"2006-01-02T15:04",
	"2006-01-02 15:04:05",
	"2006-01-02 15:04",
}

// NewID returns a fresh row id.
func NewID() string {
	return ulid.Make().String()
}

func transactionFormat(decimals int, loc *time.Location) format[domain.Transaction] {
	return format[domain.Transaction]{
		headers: transactionHeaders,
		decode: func(_ int, record []string) (domain.Transaction, error) {
			f := Fields{ID: record[0], Time: record[1], Amount: record[2], Category: record[3], Merchant: record[4], Note: record[5], Tags: record[6]}
			if len(record) > 7 {
				f.Intent = record[7]
			}
			return f.toTransaction(decimals, loc)
		},
		encode: func(t domain.Transaction) []string {
			f := fieldsOf(t, decimals)
			return []string{f.ID, f.Time, f.Amount, f.Category, f.Merchant, f.Note, f.Tags, f.Intent}
		},
		id: func(t *domain.Transaction) *string { return &t.ID },
	}
}

func (f Fields) toTransaction(decimals int, loc *time.Location) (domain.Transaction, error) {
	when, unknown, err := parseTime(strings.TrimSpace(f.Time), loc)
	if err != nil {
		return domain.Transaction{}, err
	}
	amount, err := domain.ParseMoney(strings.TrimSpace(f.Amount), decimals)
	if err != nil {
		return domain.Transaction{}, err
	}
	intent := domain.Intent(strings.ToLower(strings.TrimSpace(f.Intent)))
	if !intent.Valid() {
		return domain.Transaction{}, fmt.Errorf("invalid intent %q: use need, want or impulse", f.Intent)
	}
	if amount >= 0 {
		intent = domain.IntentNone
	}
	return domain.Transaction{
		ID:          strings.TrimSpace(f.ID),
		Time:        when,
		TimeUnknown: unknown,
		Amount:      amount,
		Category:    strings.TrimSpace(f.Category),
		Merchant:    f.Merchant,
		Note:        f.Note,
		Tags:        splitTags(f.Tags),
		Intent:      intent,
	}, nil
}

func fieldsOf(t domain.Transaction, decimals int) Fields {
	when := t.Time.Format(time.RFC3339Nano)
	if t.TimeUnknown {
		when = t.Date()
	}
	return Fields{
		ID:       t.ID,
		Time:     when,
		Amount:   t.Amount.Format(decimals),
		Category: t.Category,
		Merchant: t.Merchant,
		Note:     t.Note,
		Tags:     strings.Join(t.Tags, ";"),
		Intent:   string(t.Intent),
	}
}

// parseTime reads a full timestamp, a local date and time, or a bare date meaning "time unknown".
func parseTime(s string, loc *time.Location) (when time.Time, unknown bool, err error) {
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, false, nil
	}
	for _, layout := range localTimeLayouts {
		if t, err := time.ParseInLocation(layout, s, loc); err == nil {
			return t, false, nil
		}
	}
	if t, err := time.ParseInLocation(domain.DateLayout, s, loc); err == nil {
		return t, true, nil
	}
	return time.Time{}, false, fmt.Errorf("invalid time %q: use 2026-11-07T14:30:00+05:30, 2026-11-07 14:30 or 2026-11-07", s)
}

func splitTags(s string) []string {
	var tags []string
	for _, tag := range strings.Split(s, ";") {
		if tag = strings.TrimSpace(tag); tag != "" {
			tags = append(tags, tag)
		}
	}
	return tags
}

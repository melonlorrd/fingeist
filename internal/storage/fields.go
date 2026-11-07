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
}

var localTimeLayouts = []string{
	"2006-01-02T15:04:05",
	"2006-01-02T15:04",
	"2006-01-02 15:04:05",
	"2006-01-02 15:04",
	"2006-01-02",
}

// NewID returns a fresh transaction id.
func NewID() string {
	return ulid.Make().String()
}

func (f Fields) toTransaction(decimals int, loc *time.Location) (domain.Transaction, error) {
	when, err := parseTime(strings.TrimSpace(f.Time), loc)
	if err != nil {
		return domain.Transaction{}, err
	}
	amount, err := domain.ParseMoney(strings.TrimSpace(f.Amount), decimals)
	if err != nil {
		return domain.Transaction{}, err
	}
	return domain.Transaction{
		ID:       strings.TrimSpace(f.ID),
		Time:     when,
		Amount:   amount,
		Category: strings.TrimSpace(f.Category),
		Merchant: f.Merchant,
		Note:     f.Note,
		Tags:     splitTags(f.Tags),
	}, nil
}

func fieldsOf(t domain.Transaction, decimals int) Fields {
	return Fields{
		ID:       t.ID,
		Time:     t.Time.Format(time.RFC3339Nano),
		Amount:   t.Amount.Format(decimals),
		Category: t.Category,
		Merchant: t.Merchant,
		Note:     t.Note,
		Tags:     strings.Join(t.Tags, ";"),
	}
}

func parseTime(s string, loc *time.Location) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	for _, layout := range localTimeLayouts {
		if t, err := time.ParseInLocation(layout, s, loc); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid time %q: use 2026-11-07T14:30:00+05:30, 2026-11-07 14:30 or 2026-11-07", s)
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

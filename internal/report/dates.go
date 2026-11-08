package report

import (
	"fmt"
	"time"

	"fingeist/internal/domain"
)

// Dates are "2006-01-02" strings; arithmetic on them is plain calendar math, with no time zones involved.

func parseDate(date string) time.Time {
	t, _ := time.Parse(domain.DateLayout, date)
	return t
}

func addDays(date string, n int) string {
	return parseDate(date).AddDate(0, 0, n).Format(domain.DateLayout)
}

// daysBetween counts the days from a to b; it is negative when b is before a.
func daysBetween(a, b string) int {
	return int(parseDate(b).Sub(parseDate(a)).Hours() / 24)
}

func weekdayOf(date string) time.Weekday {
	return parseDate(date).Weekday()
}

func eachDay(start, end string, visit func(date string)) {
	for date := start; date <= end; date = addDays(date, 1) {
		visit(date)
	}
}

func monthOfDate(date string) string {
	return date[:7]
}

type monthKey int

func monthOf(t time.Time) monthKey {
	return monthKey(t.Year()*12 + int(t.Month()) - 1)
}

func (k monthKey) String() string {
	return fmt.Sprintf("%04d-%02d", int(k)/12, int(k)%12+1)
}

package report

import (
	"fmt"
	"time"

	"el-costas/internal/domain"
)

// PresetRange resolves a named range ending today. All time has no bounds.
func PresetRange(name, today string) (from, to string, err error) {
	if _, parseErr := time.Parse(domain.DateLayout, today); parseErr != nil {
		return "", "", fmt.Errorf("invalid date %q: use YYYY-MM-DD", today)
	}
	now := parseDate(today)
	switch name {
	case "this_month":
		return monthStart(now, 0), today, nil
	case "three_months":
		return monthStart(now, -2), today, nil
	case "year_to_date":
		return fmt.Sprintf("%04d-01-01", now.Year()), today, nil
	case "all_time":
		return "", "", nil
	}
	return "", "", fmt.Errorf("unknown range %q", name)
}

func monthStart(t time.Time, monthOffset int) string {
	return time.Date(t.Year(), t.Month()+time.Month(monthOffset), 1, 0, 0, 0, 0, time.UTC).Format(domain.DateLayout)
}

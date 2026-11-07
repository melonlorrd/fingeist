package report

import (
	"cmp"
	"slices"
	"strings"

	"el-costas/internal/domain"
)

// LedgerQuery narrows the ledger. Filter is all, expense, income, need, want or impulse.
// Limit caps how many days are returned, newest first; 0 means all.
type LedgerQuery struct {
	Search   string `json:"search"`
	Month    string `json:"month"`
	Category string `json:"category"`
	Filter   string `json:"filter"`
	Limit    int    `json:"limit"`
}

type LedgerRow struct {
	ID            string   `json:"id"`
	Date          string   `json:"date"`
	Time          string   `json:"time"`
	Merchant      string   `json:"merchant"`
	Note          string   `json:"note"`
	Category      string   `json:"category"`
	CategoryColor string   `json:"categoryColor"`
	Tags          []string `json:"tags"`
	Intent        string   `json:"intent"`
	Amount        Amount   `json:"amount"`
}

type LedgerDay struct {
	Date  string      `json:"date"`
	Total Amount      `json:"total"`
	Rows  []LedgerRow `json:"rows"`
}

type LedgerData struct {
	Days      []LedgerDay `json:"days"`
	TotalDays int         `json:"totalDays"`
	Months    []string    `json:"months"`
	Count     int         `json:"count"`
}

// LedgerView filters the transactions and groups them by day, newest first, with the net per day.
func LedgerView(txns []domain.Transaction, project domain.Project, q LedgerQuery) LedgerData {
	data := LedgerData{Days: []LedgerDay{}, Months: monthsNewestFirst(txns)}

	matching := []domain.Transaction{}
	for _, t := range txns {
		if matches(t, project, q) {
			matching = append(matching, t)
		}
	}
	slices.SortStableFunc(matching, func(a, b domain.Transaction) int {
		return cmp.Or(cmp.Compare(b.Date(), a.Date()), b.Time.Compare(a.Time))
	})

	var netOfDay domain.Money
	for _, t := range matching {
		if n := len(data.Days); n == 0 || data.Days[n-1].Date != t.Date() {
			data.Days = append(data.Days, LedgerDay{Date: t.Date(), Rows: []LedgerRow{}})
			netOfDay = 0
		}
		day := &data.Days[len(data.Days)-1]
		netOfDay += t.Amount
		day.Total = amountOf(netOfDay, project)
		day.Rows = append(day.Rows, ledgerRow(t, project))
	}
	data.Count = len(matching)
	data.TotalDays = len(data.Days)
	if q.Limit > 0 && len(data.Days) > q.Limit {
		data.Days = data.Days[:q.Limit]
	}
	return data
}

func ledgerRow(t domain.Transaction, project domain.Project) LedgerRow {
	category := categoryName(project, t.Category)
	timeText := ""
	if !t.TimeUnknown {
		timeText = t.Time.Format("15:04")
	}
	tags := t.Tags
	if tags == nil {
		tags = []string{}
	}
	return LedgerRow{
		ID: t.ID, Date: t.Date(), Time: timeText, Merchant: t.Merchant, Note: t.Note,
		Category: category, CategoryColor: project.CategoryColor(category), Tags: tags,
		Intent: string(t.Intent), Amount: amountOf(t.Amount, project),
	}
}

func matches(t domain.Transaction, project domain.Project, q LedgerQuery) bool {
	if q.Month != "" && monthOfDate(t.Date()) != q.Month {
		return false
	}
	if q.Category != "" && categoryName(project, t.Category) != q.Category {
		return false
	}
	switch q.Filter {
	case "expense":
		if !t.IsExpense() {
			return false
		}
	case "income":
		if t.IsExpense() {
			return false
		}
	case "need", "want", "impulse":
		if string(t.Intent) != q.Filter {
			return false
		}
	}
	return q.Search == "" || containsText(t, project, strings.ToLower(strings.TrimSpace(q.Search)))
}

func containsText(t domain.Transaction, project domain.Project, needle string) bool {
	haystack := strings.ToLower(strings.Join(append([]string{t.Merchant, t.Note, categoryName(project, t.Category)}, t.Tags...), "\n"))
	return strings.Contains(haystack, needle)
}

func monthsNewestFirst(txns []domain.Transaction) []string {
	seen := map[string]bool{}
	months := []string{}
	for _, t := range txns {
		if month := monthOfDate(t.Date()); !seen[month] {
			seen[month] = true
			months = append(months, month)
		}
	}
	slices.SortFunc(months, func(a, b string) int { return cmp.Compare(b, a) })
	return months
}

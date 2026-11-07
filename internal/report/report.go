package report

import (
	"cmp"
	"fmt"
	"slices"
	"time"

	"el-costas/internal/domain"
)

// DateLayout is the layout of the dates used for filtering and day buckets.
const DateLayout = "2006-01-02"

const uncategorized = "uncategorized"

// Amount is a money value for drawing: Minor sets the size, Text is what to show.
type Amount struct {
	Minor int64  `json:"minor"`
	Text  string `json:"text"`
}

type MonthTotal struct {
	Month    string `json:"month"`
	Income   Amount `json:"income"`
	Expenses Amount `json:"expenses"`
	Net      Amount `json:"net"`
}

type CategoryTotal struct {
	Category string `json:"category"`
	Spent    Amount `json:"spent"`
}

type DayTotal struct {
	Date  string `json:"date"`
	Spent Amount `json:"spent"`
}

// Chart is the data for one chart; only the field matching Type is filled.
type Chart struct {
	Title      string          `json:"title"`
	Type       string          `json:"type"`
	Error      string          `json:"error,omitempty"`
	Months     []MonthTotal    `json:"months"`
	Categories []CategoryTotal `json:"categories"`
	Days       []DayTotal      `json:"days"`
	From       string          `json:"from,omitempty"`
	To         string          `json:"to,omitempty"`
	Max        Amount          `json:"max"`
}

// Run builds the data for one chart definition.
func Run(def domain.ChartDef, txns []domain.Transaction, project domain.Project) Chart {
	chart := Chart{
		Title:      def.Title,
		Type:       def.Type,
		Months:     []MonthTotal{},
		Categories: []CategoryTotal{},
		Days:       []DayTotal{},
	}
	switch def.Type {
	case domain.ChartMonthlyTotals:
		chart.Months = monthlyTotals(txns, project)
	case domain.ChartByCategory:
		chart.Categories = byCategory(txns, project)
	case domain.ChartCalendarHeatmap:
		chart.Days, chart.From, chart.To, chart.Max = dailySpending(txns, project)
	default:
		chart.Error = fmt.Sprintf("unknown chart type %q", def.Type)
	}
	return chart
}

// FilterRange keeps transactions whose own wall-clock date is within [from, to]. An empty bound is open.
func FilterRange(txns []domain.Transaction, from, to string) ([]domain.Transaction, error) {
	for _, bound := range []string{from, to} {
		if _, err := time.Parse(DateLayout, bound); bound != "" && err != nil {
			return nil, fmt.Errorf("invalid date %q: use YYYY-MM-DD", bound)
		}
	}
	kept := []domain.Transaction{}
	for _, t := range txns {
		date := t.Time.Format(DateLayout)
		if (from == "" || date >= from) && (to == "" || date <= to) {
			kept = append(kept, t)
		}
	}
	return kept, nil
}

type monthKey int

func monthOf(t time.Time) monthKey {
	return monthKey(t.Year()*12 + int(t.Month()) - 1)
}

func (k monthKey) String() string {
	return fmt.Sprintf("%04d-%02d", int(k)/12, int(k)%12+1)
}

func monthlyTotals(txns []domain.Transaction, project domain.Project) []MonthTotal {
	type sums struct{ income, expenses domain.Money }
	byMonth := map[monthKey]*sums{}
	var first, last monthKey
	for i, t := range txns {
		key := monthOf(t.Time)
		if i == 0 || key < first {
			first = key
		}
		if i == 0 || key > last {
			last = key
		}
		if byMonth[key] == nil {
			byMonth[key] = &sums{}
		}
		if t.Amount > 0 {
			byMonth[key].income += t.Amount
		} else {
			byMonth[key].expenses -= t.Amount
		}
	}

	months := []MonthTotal{}
	if len(txns) == 0 {
		return months
	}
	for key := first; key <= last; key++ {
		s := byMonth[key]
		if s == nil {
			s = &sums{}
		}
		months = append(months, MonthTotal{
			Month:    key.String(),
			Income:   amountOf(s.income, project),
			Expenses: amountOf(s.expenses, project),
			Net:      amountOf(s.income-s.expenses, project),
		})
	}
	return months
}

func byCategory(txns []domain.Transaction, project domain.Project) []CategoryTotal {
	known := map[string]bool{}
	for _, c := range project.Categories {
		known[c] = true
	}
	spent := map[string]domain.Money{}
	for _, t := range txns {
		if t.Amount >= 0 {
			continue
		}
		category := t.Category
		if !known[category] {
			category = uncategorized
		}
		spent[category] -= t.Amount
	}

	categories := make([]CategoryTotal, 0, len(spent))
	for category, total := range spent {
		categories = append(categories, CategoryTotal{Category: category, Spent: amountOf(total, project)})
	}
	slices.SortFunc(categories, func(a, b CategoryTotal) int {
		return cmp.Or(cmp.Compare(b.Spent.Minor, a.Spent.Minor), cmp.Compare(a.Category, b.Category))
	})
	return categories
}

func dailySpending(txns []domain.Transaction, project domain.Project) (days []DayTotal, from, to string, peak Amount) {
	spent := map[string]domain.Money{}
	for _, t := range txns {
		if t.Amount < 0 {
			spent[t.Time.Format(DateLayout)] -= t.Amount
		}
	}

	days = make([]DayTotal, 0, len(spent))
	var biggest domain.Money
	for date, total := range spent {
		days = append(days, DayTotal{Date: date, Spent: amountOf(total, project)})
		biggest = max(biggest, total)
	}
	slices.SortFunc(days, func(a, b DayTotal) int { return cmp.Compare(a.Date, b.Date) })
	if len(days) > 0 {
		from, to = days[0].Date, days[len(days)-1].Date
	}
	return days, from, to, amountOf(biggest, project)
}

func amountOf(m domain.Money, project domain.Project) Amount {
	return Amount{Minor: int64(m), Text: m.Format(project.Decimals) + " " + project.Currency}
}

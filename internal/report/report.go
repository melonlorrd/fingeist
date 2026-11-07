package report

import (
	"cmp"
	"fmt"
	"slices"

	"el-costas/internal/domain"
)

const (
	uncategorized = "uncategorized"
	topCount      = 5
)

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
	Color    string `json:"color"`
	Spent    Amount `json:"spent"`
}

type DayTotal struct {
	Date  string `json:"date"`
	Spent Amount `json:"spent"`
}

type BalancePoint struct {
	Date    string `json:"date"`
	Balance Amount `json:"balance"`
}

type IntentMonth struct {
	Month   string `json:"month"`
	Need    Amount `json:"need"`
	Want    Amount `json:"want"`
	Impulse Amount `json:"impulse"`
}

type SmallStat struct {
	Threshold Amount `json:"threshold"`
	Count     int    `json:"count"`
	Total     Amount `json:"total"`
	Share     string `json:"share"`
	ShareBP   int64  `json:"shareBp"`
}

type NameStat struct {
	Name    string `json:"name"`
	Count   int    `json:"count"`
	Average Amount `json:"average"`
}

type HourStat struct {
	Hour        int             `json:"hour"`
	Occurrences int             `json:"occurrences"`
	Total       Amount          `json:"total"`
	Average     Amount          `json:"average"`
	Share       string          `json:"share"`
	Categories  []CategoryTotal `json:"categories"`
	Merchants   []NameStat      `json:"merchants"`
}

// HeatCell is one weekday and hour; Weekday counts from Monday = 0.
type HeatCell struct {
	Weekday int    `json:"weekday"`
	Hour    int    `json:"hour"`
	Spent   Amount `json:"spent"`
}

type NoSpendDay struct {
	Date   string `json:"date"`
	Status string `json:"status"`
}

type NoSpendMonth struct {
	Month      string       `json:"month"`
	Days       []NoSpendDay `json:"days"`
	ZeroDays   int          `json:"zeroDays"`
	BestStreak int          `json:"bestStreak"`
}

// TxnRef points at a transaction the user can open.
type TxnRef struct {
	ID       string `json:"id"`
	Date     string `json:"date"`
	Merchant string `json:"merchant"`
	Amount   Amount `json:"amount"`
}

// Chart is the data for one chart; only the fields of its Type are filled.
type Chart struct {
	Title         string          `json:"title"`
	Type          string          `json:"type"`
	Error         string          `json:"error,omitempty"`
	Months        []MonthTotal    `json:"months"`
	Categories    []CategoryTotal `json:"categories"`
	Days          []DayTotal      `json:"days"`
	From          string          `json:"from,omitempty"`
	To            string          `json:"to,omitempty"`
	Max           Amount          `json:"max"`
	Balance       []BalancePoint  `json:"balance"`
	IntentMonths  []IntentMonth   `json:"intentMonths"`
	NoIntent      int             `json:"noIntent"`
	Small         []SmallStat     `json:"small"`
	ExpenseCount  int             `json:"expenseCount"`
	ExpenseTotal  Amount          `json:"expenseTotal"`
	Hours         []HourStat      `json:"hours"`
	Workdays      int             `json:"workdays"`
	Cells         []HeatCell      `json:"cells"`
	NoSpend       []NoSpendMonth  `json:"noSpend"`
	CurrentStreak int             `json:"currentStreak"`
	NoTime        []TxnRef        `json:"noTime"`
}

// Run builds the data for one chart definition. txns are all transactions; the scope picks the range.
func Run(def domain.ChartDef, txns []domain.Transaction, project domain.Project, scope Scope) Chart {
	return buildChart(def, txns, scope.Filter(txns), project, scope)
}

// RunAll builds every chart of a dashboard, filtering the transactions by the scope once.
func RunAll(defs []domain.ChartDef, txns []domain.Transaction, project domain.Project, scope Scope) []Chart {
	inRange := scope.Filter(txns)
	charts := make([]Chart, len(defs))
	for i, def := range defs {
		charts[i] = buildChart(def, txns, inRange, project, scope)
	}
	return charts
}

func buildChart(def domain.ChartDef, txns, inRange []domain.Transaction, project domain.Project, scope Scope) Chart {
	chart := Chart{
		Title: def.Title, Type: def.Type,
		Months: []MonthTotal{}, Categories: []CategoryTotal{}, Days: []DayTotal{}, Balance: []BalancePoint{},
		IntentMonths: []IntentMonth{}, Small: []SmallStat{}, Hours: []HourStat{}, Cells: []HeatCell{},
		NoSpend: []NoSpendMonth{}, NoTime: []TxnRef{},
	}
	switch def.Type {
	case domain.ChartMonthlyTotals:
		chart.Months = monthlyTotals(inRange, project)
	case domain.ChartByCategory:
		chart.Categories = byCategory(inRange, project)
	case domain.ChartCalendarHeatmap:
		chart.Days, chart.From, chart.To, chart.Max = dailySpending(inRange, project)
	case domain.ChartRunningBalance:
		chart.Balance = runningBalance(txns, project, scope)
	case domain.ChartIntentTrends:
		chart.IntentMonths, chart.NoIntent = intentTrends(inRange, project)
	case domain.ChartSmallPurchases:
		chart.Small, chart.ExpenseCount, chart.ExpenseTotal = smallPurchases(inRange, project)
	case domain.ChartWorkdayRoutine:
		chart.Hours, chart.Workdays = workdayRoutine(inRange, txns, project, scope)
		chart.NoTime = noTimeRefs(inRange, project)
	case domain.ChartWeekdayHourHeatmap:
		chart.Cells, chart.Max = weekdayHours(inRange, project)
		chart.NoTime = noTimeRefs(inRange, project)
	case domain.ChartNoSpendCalendar:
		chart.NoSpend, chart.CurrentStreak = noSpendCalendar(txns, scope)
	default:
		chart.Error = fmt.Sprintf("unknown chart type %q", def.Type)
	}
	return chart
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
	spent := map[string]domain.Money{}
	for _, t := range txns {
		if t.IsExpense() {
			spent[categoryName(project, t.Category)] -= t.Amount
		}
	}
	return rankCategories(spent, project)
}

func rankCategories(spent map[string]domain.Money, project domain.Project) []CategoryTotal {
	categories := make([]CategoryTotal, 0, len(spent))
	for category, total := range spent {
		categories = append(categories, CategoryTotal{
			Category: category, Color: project.CategoryColor(category), Spent: amountOf(total, project),
		})
	}
	slices.SortFunc(categories, func(a, b CategoryTotal) int {
		return cmp.Or(cmp.Compare(b.Spent.Minor, a.Spent.Minor), cmp.Compare(a.Category, b.Category))
	})
	return categories
}

func dailySpending(txns []domain.Transaction, project domain.Project) (days []DayTotal, from, to string, peak Amount) {
	spent := map[string]domain.Money{}
	for _, t := range txns {
		if t.IsExpense() {
			spent[t.Date()] -= t.Amount
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

func categoryName(project domain.Project, name string) string {
	if name != "" && project.KnownCategory(name) {
		return name
	}
	return uncategorized
}

func amountOf(m domain.Money, project domain.Project) Amount {
	return Amount{Minor: int64(m), Text: m.Display(project.Currency, project.Decimals)}
}

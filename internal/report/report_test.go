package report

import (
	"fmt"
	"reflect"
	"testing"
	"time"

	"fingeist/internal/domain"
)

var usd = domain.Project{
	Name: "Home", Currency: "USD", Decimals: 2,
	Categories: []domain.Category{
		{Name: "groceries", Color: "#111111"}, {Name: "transport", Color: "#222222"},
		{Name: "salary", Color: "#333333"}, {Name: "old", Color: "#444444", Archived: true},
	},
	SmallPurchaseThresholds: []domain.Money{500, 2000},
	Workdays:                []time.Weekday{time.Monday, time.Tuesday, time.Wednesday, time.Thursday, time.Friday},
}

func txn(when string, amount domain.Money, category string) domain.Transaction {
	t, err := time.Parse(time.RFC3339, when)
	if err != nil {
		panic(err)
	}
	return domain.Transaction{ID: when, Time: t, Amount: amount, Category: category}
}

func dateOnly(date string, amount domain.Money, category string) domain.Transaction {
	t := txn(date+"T00:00:00Z", amount, category)
	t.TimeUnknown = true
	return t
}

func withIntent(t domain.Transaction, intent domain.Intent) domain.Transaction {
	t.Intent = intent
	return t
}

func run(chartType string, txns []domain.Transaction, scope Scope) Chart {
	return Run(domain.ChartDef{Title: "t", Type: chartType}, txns, usd, scope)
}

func TestMonthlyTotals(t *testing.T) {
	tests := []struct {
		name string
		txns []domain.Transaction
		want []MonthTotal
	}{
		{"no transactions", nil, []MonthTotal{}},
		{
			"income and expenses in one month",
			[]domain.Transaction{
				txn("2026-11-01T10:00:00Z", -1000, "groceries"),
				txn("2026-11-30T10:00:00Z", -250, "groceries"),
				txn("2026-11-15T10:00:00Z", 500000, "salary"),
			},
			[]MonthTotal{{
				Month:    "2026-11",
				Income:   Amount{500000, "$5,000.00"},
				Expenses: Amount{1250, "$12.50"},
				Net:      Amount{498750, "$4,987.50"},
			}},
		},
		{
			"net can be negative",
			[]domain.Transaction{txn("2026-11-01T10:00:00Z", -1000, "")},
			[]MonthTotal{{Month: "2026-11", Income: Amount{0, "$0.00"}, Expenses: Amount{1000, "$10.00"}, Net: Amount{-1000, "-$10.00"}}},
		},
		{
			"month boundary uses the row's own offset",
			[]domain.Transaction{
				txn("2026-10-31T23:30:00-05:00", -100, ""),
				txn("2026-11-01T00:30:00+05:30", -200, ""),
			},
			[]MonthTotal{
				{Month: "2026-10", Income: Amount{0, "$0.00"}, Expenses: Amount{100, "$1.00"}, Net: Amount{-100, "-$1.00"}},
				{Month: "2026-11", Income: Amount{0, "$0.00"}, Expenses: Amount{200, "$2.00"}, Net: Amount{-200, "-$2.00"}},
			},
		},
		{
			"gaps are filled and years roll over",
			[]domain.Transaction{txn("2026-12-15T10:00:00Z", -100, ""), txn("2027-02-15T10:00:00Z", -300, "")},
			[]MonthTotal{
				{Month: "2026-12", Income: Amount{0, "$0.00"}, Expenses: Amount{100, "$1.00"}, Net: Amount{-100, "-$1.00"}},
				{Month: "2027-01", Income: Amount{0, "$0.00"}, Expenses: Amount{0, "$0.00"}, Net: Amount{0, "$0.00"}},
				{Month: "2027-02", Income: Amount{0, "$0.00"}, Expenses: Amount{300, "$3.00"}, Net: Amount{-300, "-$3.00"}},
			},
		},
		{
			"date-only rows count",
			[]domain.Transaction{dateOnly("2026-11-05", -700, "")},
			[]MonthTotal{{Month: "2026-11", Income: Amount{0, "$0.00"}, Expenses: Amount{700, "$7.00"}, Net: Amount{-700, "-$7.00"}}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := run(domain.ChartMonthlyTotals, tt.txns, Scope{}).Months
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %+v\nwant %+v", got, tt.want)
			}
		})
	}
}

func TestMonthlyTotalsZeroDecimals(t *testing.T) {
	yen := domain.Project{Currency: "JPY", Decimals: 0}
	chart := Run(domain.ChartDef{Type: domain.ChartMonthlyTotals}, []domain.Transaction{txn("2026-11-01T10:00:00Z", -1500, "")}, yen, Scope{})
	if chart.Months[0].Expenses.Text != "¥1,500" {
		t.Fatalf("got %q", chart.Months[0].Expenses.Text)
	}
}

func TestByCategory(t *testing.T) {
	txns := []domain.Transaction{
		txn("2026-11-01T10:00:00Z", -500, "groceries"),
		txn("2026-11-02T10:00:00Z", -700, "groceries"),
		txn("2026-11-03T10:00:00Z", -1200, "transport"),
		txn("2026-11-04T10:00:00Z", -100, "gifts"),
		txn("2026-11-05T10:00:00Z", -200, ""),
		txn("2026-11-06T10:00:00Z", 500000, "salary"),
		txn("2026-11-07T10:00:00Z", -50, "old"),
	}
	want := []CategoryTotal{
		{"groceries", "#111111", Amount{1200, "$12.00"}},
		{"transport", "#222222", Amount{1200, "$12.00"}},
		{"uncategorized", "", Amount{300, "$3.00"}},
		{"old", "#444444", Amount{50, "$0.50"}},
	}
	got := run(domain.ChartByCategory, txns, Scope{}).Categories
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}
}

func TestByCategoryNoExpenses(t *testing.T) {
	got := run(domain.ChartByCategory, []domain.Transaction{txn("2026-11-06T10:00:00Z", 100, "salary")}, Scope{}).Categories
	if got == nil || len(got) != 0 {
		t.Fatalf("got %#v, want an empty non-nil slice", got)
	}
}

func TestCalendarHeatmap(t *testing.T) {
	txns := []domain.Transaction{
		txn("2026-11-07T23:30:00-05:00", -500, ""),
		txn("2026-11-07T01:00:00-05:00", -250, ""),
		txn("2026-11-09T09:00:00+09:00", -1000, ""),
		txn("2026-11-08T00:00:00Z", 9999, ""),
	}
	chart := run(domain.ChartCalendarHeatmap, txns, Scope{})
	wantDays := []DayTotal{{"2026-11-07", Amount{750, "$7.50"}}, {"2026-11-09", Amount{1000, "$10.00"}}}
	if !reflect.DeepEqual(chart.Days, wantDays) {
		t.Fatalf("days = %+v, want %+v", chart.Days, wantDays)
	}
	if chart.From != "2026-11-07" || chart.To != "2026-11-09" || chart.Max != (Amount{1000, "$10.00"}) {
		t.Fatalf("from = %s, to = %s, max = %+v", chart.From, chart.To, chart.Max)
	}
}

func TestRunUnknownTypeAndEmptyCharts(t *testing.T) {
	if chart := run("pie", nil, Scope{}); chart.Error == "" || chart.Title != "t" {
		t.Fatalf("got %+v", chart)
	}
	for _, chartType := range []string{
		domain.ChartMonthlyTotals, domain.ChartByCategory, domain.ChartCalendarHeatmap, domain.ChartRunningBalance,
		domain.ChartIntentTrends, domain.ChartSmallPurchases, domain.ChartWorkdayRoutine,
		domain.ChartWeekdayHourHeatmap, domain.ChartNoSpendCalendar,
	} {
		chart := run(chartType, nil, Scope{Today: "2026-11-08"})
		if chart.Error != "" || chart.Months == nil || chart.Days == nil || chart.Balance == nil || chart.Hours == nil || chart.NoSpend == nil || chart.NoTime == nil {
			t.Errorf("%s on no data: %+v", chartType, chart)
		}
	}
}

func TestScopeFilterAndValidate(t *testing.T) {
	txns := []domain.Transaction{
		txn("2026-10-31T23:59:59-05:00", 1, ""),
		txn("2026-11-01T00:00:00+05:30", 2, ""),
		txn("2026-11-30T23:59:59Z", 3, ""),
		txn("2026-12-01T00:00:00Z", 4, ""),
	}
	tests := []struct {
		name     string
		from, to string
		want     []domain.Money
	}{
		{"open range", "", "", []domain.Money{1, 2, 3, 4}},
		{"from only", "2026-11-01", "", []domain.Money{2, 3, 4}},
		{"to only", "", "2026-10-31", []domain.Money{1}},
		{"inclusive both ends", "2026-11-01", "2026-11-30", []domain.Money{2, 3}},
		{"single day", "2026-12-01", "2026-12-01", []domain.Money{4}},
		{"empty result", "2027-01-01", "", []domain.Money{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			scope := Scope{From: tt.from, To: tt.to}
			if err := scope.Validate(); err != nil {
				t.Fatal(err)
			}
			amounts := []domain.Money{}
			for _, g := range scope.Filter(txns) {
				amounts = append(amounts, g.Amount)
			}
			if !reflect.DeepEqual(amounts, tt.want) {
				t.Fatalf("got %v, want %v", amounts, tt.want)
			}
		})
	}

	for _, bad := range []Scope{{From: "11/01/2026"}, {To: "tomorrow"}, {From: "2026-12-01", To: "2026-11-01"}} {
		if bad.Validate() == nil {
			t.Errorf("%+v should be invalid", bad)
		}
	}
}

func TestRunningBalance(t *testing.T) {
	txns := []domain.Transaction{
		txn("2026-11-01T10:00:00Z", 10000, ""),
		txn("2026-11-02T10:00:00Z", -2500, ""),
		txn("2026-11-02T20:00:00Z", -500, ""),
		txn("2026-11-05T10:00:00Z", 1000, ""),
	}
	tests := []struct {
		name  string
		scope Scope
		want  []string
	}{
		{"open range ends today", Scope{Today: "2026-11-06"}, []string{"$100.00", "$70.00", "$70.00", "$70.00", "$80.00", "$80.00"}},
		{"range starts from the balance before it", Scope{From: "2026-11-02", To: "2026-11-03"}, []string{"$70.00", "$70.00"}},
		{"range after all data keeps the balance", Scope{From: "2026-11-10", To: "2026-11-11", Today: "2026-11-12"}, []string{"$80.00", "$80.00"}},
		{"future end is held back", Scope{From: "2026-11-05", To: "2999-01-01", Today: "2026-11-06"}, []string{"$80.00", "$80.00"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got []string
			for _, p := range run(domain.ChartRunningBalance, txns, tt.scope).Balance {
				got = append(got, p.Balance.Text)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %v, want %v", got, tt.want)
			}
		})
	}
}

func TestIntentTrends(t *testing.T) {
	txns := []domain.Transaction{
		withIntent(txn("2026-09-05T10:00:00Z", -1000, ""), domain.IntentNeed),
		withIntent(txn("2026-09-06T10:00:00Z", -500, ""), domain.IntentNeed),
		withIntent(txn("2026-11-05T10:00:00Z", -300, ""), domain.IntentImpulse),
		withIntent(txn("2026-11-06T10:00:00Z", -200, ""), domain.IntentWant),
		txn("2026-11-07T10:00:00Z", -999, ""),
		txn("2026-11-08T10:00:00Z", 5000, ""),
	}
	chart := run(domain.ChartIntentTrends, txns, Scope{})
	want := []IntentMonth{
		{"2026-09", Amount{1500, "$15.00"}, Amount{0, "$0.00"}, Amount{0, "$0.00"}},
		{"2026-10", Amount{0, "$0.00"}, Amount{0, "$0.00"}, Amount{0, "$0.00"}},
		{"2026-11", Amount{0, "$0.00"}, Amount{200, "$2.00"}, Amount{300, "$3.00"}},
	}
	if !reflect.DeepEqual(chart.IntentMonths, want) || chart.NoIntent != 1 {
		t.Fatalf("got %+v (no intent %d)\nwant %+v", chart.IntentMonths, chart.NoIntent, want)
	}
}

func TestSmallPurchases(t *testing.T) {
	txns := []domain.Transaction{
		txn("2026-11-01T10:00:00Z", -100, ""),
		txn("2026-11-02T10:00:00Z", -500, ""),
		txn("2026-11-03T10:00:00Z", -501, ""),
		txn("2026-11-04T10:00:00Z", -2000, ""),
		txn("2026-11-05T10:00:00Z", -7899, ""),
		txn("2026-11-06T10:00:00Z", 100000, ""),
	}
	chart := run(domain.ChartSmallPurchases, txns, Scope{})
	if chart.ExpenseCount != 5 || chart.ExpenseTotal.Text != "$110.00" {
		t.Fatalf("expense count = %d, total = %+v", chart.ExpenseCount, chart.ExpenseTotal)
	}
	want := []SmallStat{
		{Amount{500, "$5.00"}, 2, Amount{600, "$6.00"}, "5.45%", 545},
		{Amount{2000, "$20.00"}, 4, Amount{3101, "$31.01"}, "28.19%", 2819},
	}
	if !reflect.DeepEqual(chart.Small, want) {
		t.Fatalf("got %+v\nwant %+v", chart.Small, want)
	}
}

func TestSmallPurchasesWithoutExpenses(t *testing.T) {
	chart := run(domain.ChartSmallPurchases, []domain.Transaction{txn("2026-11-06T10:00:00Z", 100, "")}, Scope{})
	if chart.ExpenseCount != 0 || chart.Small[0].Share != "0.00%" {
		t.Fatalf("got %+v", chart)
	}
}

func TestWorkdayRoutine(t *testing.T) {
	// 2026-11-02 is a Monday; 2026-11-07 is a Saturday.
	txns := []domain.Transaction{
		merchant(txn("2026-11-02T09:15:00+05:30", -1000, "groceries"), "Cafe"),
		merchant(txn("2026-11-02T09:45:00+05:30", -3000, "transport"), "Cafe"),
		merchant(txn("2026-11-03T09:05:00+05:30", -500, "groceries"), "Cafe"),
		merchant(txn("2026-11-03T09:30:00+05:30", -200, ""), "Kiosk"),
		txn("2026-11-03T23:50:00-05:00", -100, "groceries"),
		merchant(txn("2026-11-07T09:10:00+05:30", -9999, "groceries"), "Cafe"),
		merchant(txn("2026-11-04T09:10:00+05:30", 7777, "salary"), "Boss"),
		dateOnly("2026-11-04", -400, "groceries"),
	}
	txns[0].Note = ""
	chart := run(domain.ChartWorkdayRoutine, txns, Scope{From: "2026-11-02", To: "2026-11-08", Today: "2026-11-08"})

	if chart.Workdays != 5 || len(chart.Hours) != 24 {
		t.Fatalf("workdays = %d, hours = %d", chart.Workdays, len(chart.Hours))
	}
	nine := chart.Hours[9]
	if nine.Occurrences != 4 || nine.Total.Text != "$47.00" || nine.Average.Text != "$11.75" || nine.Share != "40.00%" {
		t.Fatalf("09:00 = %+v", nine)
	}
	if nine.Categories[0].Category != "transport" || nine.Categories[1].Category != "groceries" || nine.Categories[2].Category != "uncategorized" {
		t.Fatalf("categories = %+v", nine.Categories)
	}
	wantMerchants := []NameStat{{"Cafe", 3, Amount{1500, "$15.00"}}, {"Kiosk", 1, Amount{200, "$2.00"}}}
	if !reflect.DeepEqual(nine.Merchants, wantMerchants) {
		t.Fatalf("merchants = %+v", nine.Merchants)
	}
	if late := chart.Hours[23]; late.Occurrences != 1 || late.Total.Text != "$1.00" {
		t.Fatalf("23:00 uses the row's own offset: %+v", late)
	}
	if chart.Hours[0].Occurrences != 0 || chart.Hours[0].Total.Text != "$0.00" || chart.Hours[0].Average.Text != "$0.00" {
		t.Fatalf("empty hour = %+v", chart.Hours[0])
	}
	if len(chart.NoTime) != 1 || chart.NoTime[0].Date != "2026-11-04" || chart.NoTime[0].Amount.Text != "-$4.00" {
		t.Fatalf("no-time list = %+v", chart.NoTime)
	}
}

func merchant(t domain.Transaction, name string) domain.Transaction {
	t.Merchant = name
	return t
}

func TestWorkdayRoutineFallsBackToNoteAndHonoursWorkdays(t *testing.T) {
	sat := txn("2026-11-07T10:00:00Z", -100, "")
	sat.Note = "Weekend brunch"
	mon := txn("2026-11-02T10:00:00Z", -100, "")
	mon.Note = "Standup donuts"

	project := usd
	project.Workdays = []time.Weekday{time.Saturday}
	chart := Run(domain.ChartDef{Type: domain.ChartWorkdayRoutine}, []domain.Transaction{sat, mon}, project, Scope{From: "2026-11-02", To: "2026-11-08", Today: "2026-11-08"})
	if chart.Workdays != 1 || chart.Hours[10].Occurrences != 1 || chart.Hours[10].Merchants[0].Name != "Weekend brunch" {
		t.Fatalf("got workdays %d, hour 10 = %+v", chart.Workdays, chart.Hours[10])
	}
}

func TestWorkdayCountStopsAtToday(t *testing.T) {
	chart := run(domain.ChartWorkdayRoutine, []domain.Transaction{txn("2026-11-02T10:00:00Z", -100, "")}, Scope{From: "2026-11-01", To: "2026-11-30", Today: "2026-11-04"})
	if chart.Workdays != 3 {
		t.Fatalf("workdays = %d, want Mon-Wed = 3", chart.Workdays)
	}
}

func TestWeekdayHourHeatmap(t *testing.T) {
	txns := []domain.Transaction{
		txn("2026-11-02T09:15:00Z", -100, ""),
		txn("2026-11-09T09:45:00Z", -300, ""),
		txn("2026-11-08T22:00:00+05:30", -700, ""),
		txn("2026-11-02T09:15:00Z", 5000, ""),
		dateOnly("2026-11-03", -999, ""),
	}
	chart := run(domain.ChartWeekdayHourHeatmap, txns, Scope{})
	want := []HeatCell{
		{0, 9, Amount{400, "$4.00"}},
		{6, 22, Amount{700, "$7.00"}},
	}
	if !reflect.DeepEqual(chart.Cells, want) || chart.Max.Text != "$7.00" || len(chart.NoTime) != 1 {
		t.Fatalf("cells = %+v, max = %+v, no time = %+v", chart.Cells, chart.Max, chart.NoTime)
	}
}

func TestNoSpendCalendar(t *testing.T) {
	txns := []domain.Transaction{
		txn("2026-10-30T10:00:00Z", -100, ""),
		txn("2026-11-02T10:00:00Z", -100, ""),
		txn("2026-11-03T10:00:00Z", 5000, ""),
		txn("2026-11-07T10:00:00Z", -100, ""),
	}
	chart := run(domain.ChartNoSpendCalendar, txns, Scope{From: "2026-11-01", Today: "2026-11-09"})

	if len(chart.NoSpend) != 1 || chart.NoSpend[0].Month != "2026-11" {
		t.Fatalf("months = %+v", chart.NoSpend)
	}
	november := chart.NoSpend[0]
	statuses := map[string]string{}
	for _, d := range november.Days {
		statuses[d.Date] = d.Status
	}
	checks := map[string]string{
		"2026-11-01": "zero", "2026-11-02": "spent", "2026-11-03": "zero", "2026-11-04": "zero",
		"2026-11-07": "spent", "2026-11-08": "zero", "2026-11-09": "zero", "2026-11-10": "future", "2026-11-30": "future",
	}
	for date, want := range checks {
		if statuses[date] != want {
			t.Errorf("%s = %q, want %q", date, statuses[date], want)
		}
	}
	if len(november.Days) != 30 {
		t.Errorf("days = %d, want 30", len(november.Days))
	}
	if november.ZeroDays != 7 || november.BestStreak != 4 {
		t.Errorf("zero days = %d, best streak = %d; want 7 and 4 (Nov 3-6)", november.ZeroDays, november.BestStreak)
	}
	if chart.CurrentStreak != 2 {
		t.Errorf("current streak = %d, want 2 (Nov 8-9)", chart.CurrentStreak)
	}
}

func TestNoSpendCalendarEdges(t *testing.T) {
	t.Run("days before the first transaction are not zero-expense days", func(t *testing.T) {
		chart := run(domain.ChartNoSpendCalendar, []domain.Transaction{txn("2026-11-05T10:00:00Z", -100, "")}, Scope{Today: "2026-11-06"})
		if chart.NoSpend[0].Days[0].Status != "outside" || chart.NoSpend[0].ZeroDays != 1 {
			t.Fatalf("got %+v", chart.NoSpend[0])
		}
	})
	t.Run("spending today ends the streak", func(t *testing.T) {
		chart := run(domain.ChartNoSpendCalendar, []domain.Transaction{txn("2026-11-01T10:00:00Z", 100, ""), txn("2026-11-06T10:00:00Z", -100, "")}, Scope{Today: "2026-11-06"})
		if chart.CurrentStreak != 0 {
			t.Fatalf("streak = %d", chart.CurrentStreak)
		}
	})
	t.Run("range spanning two months", func(t *testing.T) {
		chart := run(domain.ChartNoSpendCalendar, []domain.Transaction{txn("2026-10-20T10:00:00Z", -100, "")}, Scope{From: "2026-10-25", To: "2026-12-05", Today: "2026-12-31"})
		if len(chart.NoSpend) != 3 || chart.NoSpend[0].Month != "2026-10" || chart.NoSpend[2].Month != "2026-12" {
			t.Fatalf("months = %+v", chart.NoSpend)
		}
		if chart.NoSpend[0].Days[23].Status != "outside" || chart.NoSpend[0].ZeroDays != 7 {
			t.Fatalf("october = %+v", chart.NoSpend[0])
		}
	})
}

func TestSummarize(t *testing.T) {
	txns := []domain.Transaction{
		txn("2026-10-24T10:00:00Z", -1000, ""),
		txn("2026-10-25T10:00:00Z", 2000, ""),
		txn("2026-11-02T10:00:00Z", -1500, ""),
		txn("2026-11-05T10:00:00Z", -500, ""),
		txn("2026-11-06T10:00:00Z", 4000, ""),
	}
	summary := Summarize(txns, usd, Scope{From: "2026-11-01", Today: "2026-11-08"})
	cards := map[string]Card{}
	for _, c := range summary.Cards {
		cards[c.Key] = c
	}

	if len(summary.Cards) != 4 {
		t.Fatalf("cards = %d", len(summary.Cards))
	}
	if c := cards["spent"]; c.Value.Text != "$20.00" || c.Change != "+100.00% vs previous period" {
		t.Errorf("spent = %+v", c)
	}
	if c := cards["income"]; c.Value.Text != "$40.00" || c.Change != "+100.00% vs previous period" {
		t.Errorf("income = %+v", c)
	}
	if c := cards["savings"]; c.Value.Text != "$20.00" || c.Change != "+100.00% vs previous period" {
		t.Errorf("savings = %+v", c)
	}
	if c := cards["average"]; c.Value.Text != "$2.50" || c.Detail != "over 2 expense transactions" || c.Change != "+100.00% vs previous period" {
		t.Errorf("average = %+v", c)
	}
}

func TestSummarizeComparisons(t *testing.T) {
	txns := []domain.Transaction{txn("2026-11-02T10:00:00Z", -1000, ""), txn("2026-11-03T10:00:00Z", 100, "")}
	tests := []struct {
		name       string
		scope      Scope
		wantSpent  string
		wantChange string
	}{
		{"all time has no previous", Scope{Today: "2026-11-08"}, "$10.00", "No previous data"},
		{"previous period empty", Scope{From: "2026-11-01", Today: "2026-11-08"}, "$10.00", "No previous data"},
		{"empty range with data before", Scope{From: "2026-11-10", To: "2026-11-12", Today: "2026-11-15"}, "$0.00", "No previous data"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spent := Summarize(txns, usd, tt.scope).Cards[0]
			if spent.Value.Text != tt.wantSpent || spent.Change != tt.wantChange {
				t.Fatalf("got %+v", spent)
			}
		})
	}

	t.Run("previous period had income only", func(t *testing.T) {
		both := []domain.Transaction{txn("2026-10-30T10:00:00Z", 500, ""), txn("2026-11-02T10:00:00Z", -1000, "")}
		spent := Summarize(both, usd, Scope{From: "2026-11-01", To: "2026-11-02", Today: "2026-11-08"}).Cards[0]
		if spent.Change != "Up from zero" {
			t.Fatalf("got %+v", spent)
		}
	})
	t.Run("nothing at all", func(t *testing.T) {
		for _, c := range Summarize(nil, usd, Scope{}).Cards {
			if c.Value.Minor != 0 || c.Change != "No previous data" {
				t.Errorf("%+v", c)
			}
		}
	})
	t.Run("spending went down", func(t *testing.T) {
		both := []domain.Transaction{txn("2026-10-31T10:00:00Z", -2000, ""), txn("2026-11-01T10:00:00Z", -500, "")}
		spent := Summarize(both, usd, Scope{From: "2026-11-01", To: "2026-11-01", Today: "2026-11-08"}).Cards[0]
		if spent.Change != "-75.00% vs previous period" {
			t.Fatalf("got %+v", spent)
		}
	})
}

func TestLedgerView(t *testing.T) {
	coffee := txn("2026-11-07T09:30:00+05:30", -450, "groceries")
	coffee.Merchant, coffee.Tags = "Cafe Mocha", []string{"morning", "treat"}
	coffee.Intent = domain.IntentWant
	lunch := txn("2026-11-07T13:00:00+05:30", -1200, "")
	lunch.Note = "team lunch"
	pay := dateOnly("2026-11-07", 100000, "salary")
	older := txn("2026-10-30T10:00:00Z", -300, "old")
	txns := []domain.Transaction{coffee, older, lunch, pay}

	data := LedgerView(txns, usd, LedgerQuery{})
	if data.Count != 4 || len(data.Days) != 2 || !reflect.DeepEqual(data.Months, []string{"2026-11", "2026-10"}) {
		t.Fatalf("count = %d, days = %d, months = %v", data.Count, len(data.Days), data.Months)
	}
	day := data.Days[0]
	if day.Date != "2026-11-07" || day.Total.Text != "$983.50" || len(day.Rows) != 3 {
		t.Fatalf("first day = %+v", day)
	}
	if day.Rows[0].Merchant != "" || day.Rows[0].Note != "team lunch" || day.Rows[0].Time != "13:00" || day.Rows[1].Time != "09:30" || day.Rows[2].Time != "" {
		t.Fatalf("rows are newest first with unknown times last: %+v", day.Rows)
	}
	if row := day.Rows[1]; row.Category != "groceries" || row.CategoryColor != "#111111" || row.Intent != "want" || row.Amount.Text != "-$4.50" {
		t.Fatalf("row = %+v", row)
	}
	if day.Rows[0].Category != "uncategorized" {
		t.Fatalf("blank category = %q", day.Rows[0].Category)
	}
	if old := data.Days[1].Rows[0]; old.Category != "old" || old.CategoryColor != "#444444" {
		t.Fatalf("archived categories stay valid: %+v", old)
	}

	filters := []struct {
		name  string
		query LedgerQuery
		want  int
	}{
		{"search merchant", LedgerQuery{Search: "mocha"}, 1},
		{"search note", LedgerQuery{Search: "  TEAM "}, 1},
		{"search category", LedgerQuery{Search: "salary"}, 1},
		{"search tag", LedgerQuery{Search: "morning"}, 1},
		{"search no match", LedgerQuery{Search: "zzz"}, 0},
		{"month", LedgerQuery{Month: "2026-10"}, 1},
		{"category", LedgerQuery{Category: "groceries"}, 1},
		{"uncategorized", LedgerQuery{Category: "uncategorized"}, 1},
		{"expenses", LedgerQuery{Filter: "expense"}, 3},
		{"income", LedgerQuery{Filter: "income"}, 1},
		{"wants", LedgerQuery{Filter: "want"}, 1},
		{"needs", LedgerQuery{Filter: "need"}, 0},
		{"impulses", LedgerQuery{Filter: "impulse"}, 0},
		{"all", LedgerQuery{Filter: "all"}, 4},
		{"combined", LedgerQuery{Filter: "expense", Month: "2026-11", Search: "cafe"}, 1},
	}
	for _, tt := range filters {
		t.Run(tt.name, func(t *testing.T) {
			got := LedgerView(txns, usd, tt.query)
			if got.Count != tt.want || len(got.Months) != 2 {
				t.Fatalf("count = %d, want %d (months %v)", got.Count, tt.want, got.Months)
			}
		})
	}

	if empty := LedgerView(nil, usd, LedgerQuery{}); empty.Days == nil || empty.Months == nil {
		t.Fatalf("empty ledger must give empty slices: %+v", empty)
	}
}

func TestLedgerGroupsByOwnDateNotInstant(t *testing.T) {
	late := txn("2026-11-07T23:30:00-05:00", -100, "")
	early := txn("2026-11-08T00:30:00+05:30", -200, "")
	data := LedgerView([]domain.Transaction{late, early}, usd, LedgerQuery{})
	if len(data.Days) != 2 || data.Days[0].Date != "2026-11-08" || data.Days[1].Date != "2026-11-07" {
		t.Fatalf("days = %+v", data.Days)
	}
}

func TestPresetRange(t *testing.T) {
	tests := []struct {
		name, today, wantFrom, wantTo string
		wantErr                       bool
	}{
		{"this_month", "2026-11-08", "2026-11-01", "2026-11-08", false},
		{"three_months", "2026-11-08", "2026-09-01", "2026-11-08", false},
		{"three_months", "2026-02-10", "2025-12-01", "2026-02-10", false},
		{"year_to_date", "2026-11-08", "2026-01-01", "2026-11-08", false},
		{"all_time", "2026-11-08", "", "", false},
		{"last_week", "2026-11-08", "", "", true},
		{"this_month", "soon", "", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name+" "+tt.today, func(t *testing.T) {
			from, to, err := PresetRange(tt.name, tt.today)
			if (err != nil) != tt.wantErr || from != tt.wantFrom || to != tt.wantTo {
				t.Fatalf("got %q, %q, %v; want %q, %q", from, to, err, tt.wantFrom, tt.wantTo)
			}
		})
	}
}

func TestRunAllMatchesRunningEachChart(t *testing.T) {
	txns := []domain.Transaction{
		txn("2026-10-30T10:00:00Z", -100, "groceries"),
		txn("2026-11-02T09:15:00Z", -700, "transport"),
		txn("2026-11-03T10:00:00Z", 5000, "salary"),
		dateOnly("2026-11-04", -300, ""),
	}
	defs := []domain.ChartDef{
		{Title: "a", Type: domain.ChartMonthlyTotals}, {Title: "b", Type: domain.ChartByCategory},
		{Title: "c", Type: domain.ChartRunningBalance}, {Title: "d", Type: domain.ChartWorkdayRoutine},
		{Title: "e", Type: domain.ChartNoSpendCalendar}, {Title: "f", Type: "pie"},
	}
	scope := Scope{From: "2026-11-01", Today: "2026-11-08"}

	got := RunAll(defs, txns, usd, scope)
	for i, def := range defs {
		if want := Run(def, txns, usd, scope); !reflect.DeepEqual(got[i], want) {
			t.Errorf("chart %q differs between RunAll and Run", def.Title)
		}
	}
	if len(RunAll(nil, txns, usd, scope)) != 0 {
		t.Error("no definitions, no charts")
	}
}

func TestLedgerViewLimitsDaysButCountsEverything(t *testing.T) {
	var txns []domain.Transaction
	for day := 1; day <= 10; day++ {
		txns = append(txns, txn(fmt.Sprintf("2026-11-%02dT10:00:00Z", day), -100, ""), txn(fmt.Sprintf("2026-11-%02dT12:00:00Z", day), -200, ""))
	}

	data := LedgerView(txns, usd, LedgerQuery{Limit: 3})
	if len(data.Days) != 3 || data.TotalDays != 10 || data.Count != 20 {
		t.Fatalf("days = %d, total days = %d, count = %d", len(data.Days), data.TotalDays, data.Count)
	}
	if data.Days[0].Date != "2026-11-10" || data.Days[2].Date != "2026-11-08" || len(data.Days[0].Rows) != 2 {
		t.Fatalf("the newest days come first and keep all their rows: %+v", data.Days)
	}

	for _, limit := range []int{0, 10, 99} {
		if all := LedgerView(txns, usd, LedgerQuery{Limit: limit}); len(all.Days) != 10 || all.TotalDays != 10 {
			t.Errorf("limit %d: days = %d, total days = %d", limit, len(all.Days), all.TotalDays)
		}
	}
	if filtered := LedgerView(txns, usd, LedgerQuery{Search: "nothing matches", Limit: 3}); len(filtered.Days) != 0 || filtered.TotalDays != 0 {
		t.Errorf("no matches: %+v", filtered)
	}
}

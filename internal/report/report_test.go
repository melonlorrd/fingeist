package report

import (
	"reflect"
	"testing"
	"time"

	"el-costas/internal/domain"
)

var usd = domain.Project{Name: "Home", Currency: "USD", Decimals: 2, Categories: []string{"groceries", "transport", "salary"}}

func txn(when string, amount domain.Money, category string) domain.Transaction {
	t, err := time.Parse(time.RFC3339, when)
	if err != nil {
		panic(err)
	}
	return domain.Transaction{Time: t, Amount: amount, Category: category}
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
				Income:   Amount{500000, "5000.00 USD"},
				Expenses: Amount{1250, "12.50 USD"},
				Net:      Amount{498750, "4987.50 USD"},
			}},
		},
		{
			"net can be negative",
			[]domain.Transaction{txn("2026-11-01T10:00:00Z", -1000, "")},
			[]MonthTotal{{
				Month:    "2026-11",
				Income:   Amount{0, "0.00 USD"},
				Expenses: Amount{1000, "10.00 USD"},
				Net:      Amount{-1000, "-10.00 USD"},
			}},
		},
		{
			"month boundary uses the row's own offset",
			[]domain.Transaction{
				txn("2026-10-31T23:30:00-05:00", -100, ""),
				txn("2026-11-01T00:30:00+05:30", -200, ""),
			},
			[]MonthTotal{
				{Month: "2026-10", Income: Amount{0, "0.00 USD"}, Expenses: Amount{100, "1.00 USD"}, Net: Amount{-100, "-1.00 USD"}},
				{Month: "2026-11", Income: Amount{0, "0.00 USD"}, Expenses: Amount{200, "2.00 USD"}, Net: Amount{-200, "-2.00 USD"}},
			},
		},
		{
			"gaps are filled and years roll over",
			[]domain.Transaction{
				txn("2026-12-15T10:00:00Z", -100, ""),
				txn("2027-02-15T10:00:00Z", -300, ""),
			},
			[]MonthTotal{
				{Month: "2026-12", Income: Amount{0, "0.00 USD"}, Expenses: Amount{100, "1.00 USD"}, Net: Amount{-100, "-1.00 USD"}},
				{Month: "2027-01", Income: Amount{0, "0.00 USD"}, Expenses: Amount{0, "0.00 USD"}, Net: Amount{0, "0.00 USD"}},
				{Month: "2027-02", Income: Amount{0, "0.00 USD"}, Expenses: Amount{300, "3.00 USD"}, Net: Amount{-300, "-3.00 USD"}},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Run(domain.ChartDef{Type: domain.ChartMonthlyTotals}, tt.txns, usd).Months
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %+v\nwant %+v", got, tt.want)
			}
		})
	}
}

func TestMonthlyTotalsZeroDecimals(t *testing.T) {
	yen := domain.Project{Currency: "JPY", Decimals: 0}
	got := Run(domain.ChartDef{Type: domain.ChartMonthlyTotals}, []domain.Transaction{txn("2026-11-01T10:00:00Z", -1500, "")}, yen).Months
	if got[0].Expenses.Text != "1500 JPY" {
		t.Fatalf("got %q", got[0].Expenses.Text)
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
	}
	want := []CategoryTotal{
		{"groceries", Amount{1200, "12.00 USD"}},
		{"transport", Amount{1200, "12.00 USD"}},
		{"uncategorized", Amount{300, "3.00 USD"}},
	}
	got := Run(domain.ChartDef{Type: domain.ChartByCategory}, txns, usd).Categories
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}
}

func TestByCategoryNoExpenses(t *testing.T) {
	got := Run(domain.ChartDef{Type: domain.ChartByCategory}, []domain.Transaction{txn("2026-11-06T10:00:00Z", 100, "salary")}, usd).Categories
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
	chart := Run(domain.ChartDef{Type: domain.ChartCalendarHeatmap}, txns, usd)

	wantDays := []DayTotal{
		{"2026-11-07", Amount{750, "7.50 USD"}},
		{"2026-11-09", Amount{1000, "10.00 USD"}},
	}
	if !reflect.DeepEqual(chart.Days, wantDays) {
		t.Fatalf("days = %+v, want %+v", chart.Days, wantDays)
	}
	if chart.From != "2026-11-07" || chart.To != "2026-11-09" || chart.Max != (Amount{1000, "10.00 USD"}) {
		t.Fatalf("from = %s, to = %s, max = %+v", chart.From, chart.To, chart.Max)
	}
}

func TestCalendarHeatmapEmpty(t *testing.T) {
	chart := Run(domain.ChartDef{Type: domain.ChartCalendarHeatmap}, nil, usd)
	if chart.Days == nil || len(chart.Days) != 0 || chart.From != "" || chart.Max.Minor != 0 {
		t.Fatalf("got %+v", chart)
	}
}

func TestRunUnknownType(t *testing.T) {
	chart := Run(domain.ChartDef{Title: "Pie", Type: "pie"}, nil, usd)
	if chart.Error == "" || chart.Title != "Pie" {
		t.Fatalf("got %+v", chart)
	}
}

func TestFilterRange(t *testing.T) {
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
		wantErr  bool
	}{
		{"open range", "", "", []domain.Money{1, 2, 3, 4}, false},
		{"from only", "2026-11-01", "", []domain.Money{2, 3, 4}, false},
		{"to only", "", "2026-10-31", []domain.Money{1}, false},
		{"inclusive both ends", "2026-11-01", "2026-11-30", []domain.Money{2, 3}, false},
		{"single day", "2026-12-01", "2026-12-01", []domain.Money{4}, false},
		{"empty result", "2027-01-01", "", []domain.Money{}, false},
		{"bad date", "11/01/2026", "", nil, true},
		{"bad to date", "", "tomorrow", nil, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := FilterRange(txns, tt.from, tt.to)
			if (err != nil) != tt.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantErr {
				return
			}
			amounts := []domain.Money{}
			for _, g := range got {
				amounts = append(amounts, g.Amount)
			}
			if !reflect.DeepEqual(amounts, tt.want) {
				t.Fatalf("got %v, want %v", amounts, tt.want)
			}
		})
	}
}

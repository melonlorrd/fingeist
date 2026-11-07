package portfolio

import (
	"testing"
	"time"

	"el-costas/internal/domain"
)

var inr = domain.Project{Currency: "INR", Decimals: 2}

func dec(t *testing.T, s string) domain.Decimal {
	t.Helper()
	d, err := domain.ParseDecimal(s)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func holding(t *testing.T, class domain.AssetClass, name, units, buy, current string, asOf time.Time) domain.Holding {
	t.Helper()
	return domain.Holding{
		ID: name, Class: class, Name: name, Units: dec(t, units), AvgBuyPrice: dec(t, buy), CurrentPrice: dec(t, current), PriceAsOf: asOf,
	}
}

var now = time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC)

func TestBuildTotalsAndRows(t *testing.T) {
	holdings := []domain.Holding{
		holding(t, domain.ClassGold, "Coins", "12.5", "6000", "7000", now),
		holding(t, domain.ClassMutualFund, "Index fund", "684.797", "52.3417", "55.10", now.Add(-time.Hour)),
		holding(t, domain.ClassEquity, "Acme", "10", "250", "200", now),
	}
	view, err := Build(holdings, inr, 1500000, now)
	if err != nil {
		t.Fatal(err)
	}

	// fund: value 684.797*55.10 = 37,732.3147 -> 37,732.31; invested 684.797*52.3417 = 35,843.44
	if view.PortfolioValue != "₹127,232.31" || view.TotalInvested != "₹113,343.44" {
		t.Fatalf("value = %s, invested = %s", view.PortfolioValue, view.TotalInvested)
	}
	if view.TotalReturns != "₹13,888.87" || view.TotalReturnsPct != "+12.25%" || view.ReturnsTrend != "up" {
		t.Fatalf("returns = %s %s %s", view.TotalReturns, view.TotalReturnsPct, view.ReturnsTrend)
	}
	if view.NetWorth != "₹142,232.31" {
		t.Fatalf("net worth = %s", view.NetWorth)
	}

	names := []string{view.Holdings[0].Name, view.Holdings[1].Name, view.Holdings[2].Name}
	if names[0] != "Index fund" || names[1] != "Acme" || names[2] != "Coins" {
		t.Fatalf("rows must follow class order: %v", names)
	}
	fund, acme, gold := view.Holdings[0], view.Holdings[1], view.Holdings[2]
	if fund.Units != "684.797" || fund.CurrentPrice != "₹55.10" || fund.AvgBuyPrice != "₹52.3417" || fund.Value != "₹37,732.31" || fund.Gain != "₹1,888.87" || fund.GainPct != "+5.27%" {
		t.Fatalf("fund = %+v", fund)
	}
	if acme.Gain != "-₹500.00" || acme.GainPct != "-20.00%" || acme.GainTrend != "down" {
		t.Fatalf("acme = %+v", acme)
	}
	if gold.Units != "12.5 g" || gold.Value != "₹87,500.00" {
		t.Fatalf("gold = %+v", gold)
	}
}

func TestBuildOutOfDate(t *testing.T) {
	tests := []struct {
		name string
		asOf time.Time
		want bool
	}{
		{"fresh", now.Add(-time.Hour), false},
		{"three days is still fine", now.Add(-72 * time.Hour), false},
		{"older than three days", now.Add(-73 * time.Hour), true},
		{"never priced", time.Time{}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			view, err := Build([]domain.Holding{holding(t, domain.ClassEquity, "A", "1", "10", "10", tt.asOf)}, inr, 0, now)
			if err != nil || view.Holdings[0].OutOfDate != tt.want {
				t.Fatalf("got %+v, %v", view.Holdings[0], err)
			}
		})
	}

	view, _ := Build([]domain.Holding{holding(t, domain.ClassEquity, "A", "1", "10", "10", time.Time{})}, inr, 0, now)
	if view.Holdings[0].PriceAsOf != "never updated" {
		t.Fatalf("as-of = %q", view.Holdings[0].PriceAsOf)
	}
	view, _ = Build([]domain.Holding{holding(t, domain.ClassEquity, "A", "1", "10", "10", now)}, inr, 0, now)
	if view.Holdings[0].PriceAsOf != "2026-11-08 12:00" {
		t.Fatalf("as-of = %q", view.Holdings[0].PriceAsOf)
	}
}

func TestBuildAllocation(t *testing.T) {
	holdings := []domain.Holding{
		holding(t, domain.ClassEquity, "Acme", "1", "100", "100", now),
		holding(t, domain.ClassGold, "Coins", "1", "300", "300", now),
	}
	project := inr
	project.TargetAllocation = map[domain.AssetClass]int{domain.ClassMutualFund: 40, domain.ClassEquity: 30, domain.ClassGold: 30}
	view, err := Build(holdings, project, 0, now)
	if err != nil {
		t.Fatal(err)
	}

	if len(view.Allocation) != 3 {
		t.Fatalf("allocation = %+v", view.Allocation)
	}
	fund, equity, gold := view.Allocation[0], view.Allocation[1], view.Allocation[2]
	if fund.Class != "mutual_fund" || fund.ActualPct != "0.00%" || fund.TargetPct != "40%" || fund.Drift != "-40.00%" || fund.DriftTrend != "down" {
		t.Fatalf("fund = %+v", fund)
	}
	if equity.ActualPct != "25.00%" || equity.ActualBP != 2500 || equity.TargetBP != 3000 || equity.Drift != "-5.00%" {
		t.Fatalf("equity = %+v", equity)
	}
	if gold.ActualPct != "75.00%" || gold.Drift != "+45.00%" || gold.DriftTrend != "up" || gold.Value != "₹300.00" {
		t.Fatalf("gold = %+v", gold)
	}
}

func TestBuildAllocationWithoutTargets(t *testing.T) {
	view, err := Build([]domain.Holding{holding(t, domain.ClassEquity, "Acme", "1", "100", "100", now)}, inr, 0, now)
	if err != nil || len(view.Allocation) != 1 {
		t.Fatalf("allocation = %+v, %v", view.Allocation, err)
	}
	if a := view.Allocation[0]; a.HasTarget || a.Drift != "" || a.ActualPct != "100.00%" {
		t.Fatalf("got %+v", a)
	}
}

func TestBuildEmpty(t *testing.T) {
	view, err := Build(nil, inr, -250000, now)
	if err != nil {
		t.Fatal(err)
	}
	if view.PortfolioValue != "₹0.00" || view.NetWorth != "-₹2,500.00" || view.TotalReturnsPct != "" || view.ReturnsTrend != "flat" {
		t.Fatalf("got %+v", view)
	}
	if view.Holdings == nil || view.Allocation == nil || len(view.Holdings) != 0 {
		t.Fatalf("empty slices expected: %+v", view)
	}
}

func TestBuildZeroCostHolding(t *testing.T) {
	view, err := Build([]domain.Holding{holding(t, domain.ClassEquity, "Gift shares", "5", "0", "20", now)}, inr, 0, now)
	if err != nil || view.Holdings[0].GainPct != "" || view.Holdings[0].Gain != "₹100.00" {
		t.Fatalf("got %+v, %v", view.Holdings[0], err)
	}
}

func TestBuildOverflow(t *testing.T) {
	huge := holding(t, domain.ClassEquity, "Huge", "99999999999999", "99999999999999", "1", now)
	if _, err := Build([]domain.Holding{huge}, inr, 0, now); err == nil {
		t.Fatal("expected an overflow error")
	}
}

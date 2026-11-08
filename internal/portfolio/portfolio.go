package portfolio

import (
	"cmp"
	"fmt"
	"slices"
	"time"

	"fingeist/internal/domain"
)

// staleAfter is how old a price may get before it is shown as out of date.
const staleAfter = 72 * time.Hour

type Allocation struct {
	Class      string `json:"class"`
	Label      string `json:"label"`
	Value      string `json:"value"`
	ActualPct  string `json:"actualPct"`
	ActualBP   int64  `json:"actualBp"`
	HasTarget  bool   `json:"hasTarget"`
	TargetPct  string `json:"targetPct"`
	TargetBP   int64  `json:"targetBp"`
	Drift      string `json:"drift"`
	DriftTrend string `json:"driftTrend"`
}

type Row struct {
	ID           string `json:"id"`
	Class        string `json:"class"`
	ClassLabel   string `json:"classLabel"`
	Name         string `json:"name"`
	Ticker       string `json:"ticker"`
	Units        string `json:"units"`
	AvgBuyPrice  string `json:"avgBuyPrice"`
	CurrentPrice string `json:"currentPrice"`
	Value        string `json:"value"`
	Invested     string `json:"invested"`
	Gain         string `json:"gain"`
	GainPct      string `json:"gainPct"`
	GainTrend    string `json:"gainTrend"`
	PriceAsOf    string `json:"priceAsOf"`
	PriceSource  string `json:"priceSource"`
	OutOfDate    bool   `json:"outOfDate"`
	Notes        string `json:"notes"`
}

type View struct {
	NetWorth        string       `json:"netWorth"`
	PortfolioValue  string       `json:"portfolioValue"`
	TotalInvested   string       `json:"totalInvested"`
	TotalReturns    string       `json:"totalReturns"`
	TotalReturnsPct string       `json:"totalReturnsPct"`
	ReturnsTrend    string       `json:"returnsTrend"`
	Allocation      []Allocation `json:"allocation"`
	Holdings        []Row        `json:"holdings"`
}

// Build values the holdings and compares the mix with the project's targets.
// ledgerBalance is the running balance of the ledger, added to the portfolio for net worth.
func Build(holdings []domain.Holding, project domain.Project, ledgerBalance domain.Money, now time.Time) (View, error) {
	sorted := slices.Clone(holdings)
	slices.SortStableFunc(sorted, func(a, b domain.Holding) int {
		return cmp.Or(
			cmp.Compare(slices.Index(domain.AssetClasses, a.Class), slices.Index(domain.AssetClasses, b.Class)),
			cmp.Compare(a.Name, b.Name),
		)
	})

	view := View{Allocation: []Allocation{}, Holdings: []Row{}}
	var totalValue, totalInvested domain.Money
	valueByClass := map[domain.AssetClass]domain.Money{}
	for _, h := range sorted {
		value, err := h.Units.Times(h.CurrentPrice, project.Decimals)
		if err != nil {
			return View{}, fmt.Errorf("%s: %w", h.Name, err)
		}
		invested, err := h.Units.Times(h.AvgBuyPrice, project.Decimals)
		if err != nil {
			return View{}, fmt.Errorf("%s: %w", h.Name, err)
		}
		totalValue += value
		totalInvested += invested
		valueByClass[h.Class] += value
		view.Holdings = append(view.Holdings, row(h, value, invested, project, now))
	}

	money := func(m domain.Money) string { return m.Display(project.Currency, project.Decimals) }
	returns := totalValue - totalInvested
	view.NetWorth = money(totalValue + ledgerBalance)
	view.PortfolioValue = money(totalValue)
	view.TotalInvested = money(totalInvested)
	view.TotalReturns = money(returns)
	view.TotalReturnsPct = percentOf(returns, totalInvested)
	view.ReturnsTrend = trend(int64(returns))
	view.Allocation = allocation(sorted, valueByClass, totalValue, project)
	return view, nil
}

func row(h domain.Holding, value, invested domain.Money, project domain.Project, now time.Time) Row {
	gain := value - invested
	units := h.Units.String()
	if h.Class == domain.ClassGold {
		units += " g"
	}
	asOf := "never updated"
	if !h.PriceAsOf.IsZero() {
		asOf = h.PriceAsOf.Format("2006-01-02 15:04")
	}
	prefix := domain.CurrencyPrefix(project.Currency)
	return Row{
		ID: h.ID, Class: string(h.Class), ClassLabel: h.Class.Label(), Name: h.Name, Ticker: h.Ticker,
		Units: units, AvgBuyPrice: prefix + h.AvgBuyPrice.String(), CurrentPrice: prefix + h.CurrentPrice.String(),
		Value: value.Display(project.Currency, project.Decimals), Invested: invested.Display(project.Currency, project.Decimals),
		Gain: gain.Display(project.Currency, project.Decimals), GainPct: percentOf(gain, invested), GainTrend: trend(int64(gain)),
		PriceAsOf: asOf, PriceSource: h.PriceSource,
		OutOfDate: h.PriceAsOf.IsZero() || now.Sub(h.PriceAsOf) > staleAfter,
		Notes:     h.Notes,
	}
}

func allocation(holdings []domain.Holding, valueByClass map[domain.AssetClass]domain.Money, total domain.Money, project domain.Project) []Allocation {
	rows := []Allocation{}
	for _, class := range domain.AssetClasses {
		target, hasTarget := project.TargetAllocation[class]
		held := slices.ContainsFunc(holdings, func(h domain.Holding) bool { return h.Class == class })
		if !held && !hasTarget {
			continue
		}

		actualBP := domain.BasisPoints(int64(valueByClass[class]), int64(total))
		a := Allocation{
			Class: string(class), Label: class.Label(), Value: valueByClass[class].Display(project.Currency, project.Decimals),
			ActualPct: domain.FormatBasisPoints(actualBP, false), ActualBP: actualBP, HasTarget: hasTarget,
		}
		if hasTarget {
			a.TargetBP = int64(target) * 100
			a.TargetPct = fmt.Sprintf("%d%%", target)
			a.Drift = domain.FormatBasisPoints(actualBP-a.TargetBP, true)
			a.DriftTrend = trend(actualBP - a.TargetBP)
		}
		rows = append(rows, a)
	}
	return rows
}

func percentOf(part, whole domain.Money) string {
	if whole == 0 {
		return ""
	}
	return domain.FormatBasisPoints(domain.BasisPoints(int64(part), int64(whole)), true)
}

func trend(n int64) string {
	switch {
	case n > 0:
		return "up"
	case n < 0:
		return "down"
	}
	return "flat"
}

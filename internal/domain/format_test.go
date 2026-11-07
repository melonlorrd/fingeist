package domain

import (
	"math"
	"testing"
)

func TestMoneyDisplay(t *testing.T) {
	tests := []struct {
		name     string
		m        Money
		currency string
		decimals int
		want     string
	}{
		{"inr standard grouping", 88372729, "INR", 2, "₹883,727.29"},
		{"negative", -123450, "INR", 2, "-₹1,234.50"},
		{"zero", 0, "INR", 2, "₹0.00"},
		{"small", 5, "INR", 2, "₹0.05"},
		{"usd", 100000, "USD", 2, "$1,000.00"},
		{"eur", -5, "EUR", 2, "-€0.05"},
		{"gbp", 123456789, "GBP", 2, "£1,234,567.89"},
		{"jpy no decimals", 1500000, "JPY", 0, "¥1,500,000"},
		{"unknown currency uses code", 123456, "CHF", 2, "CHF 1,234.56"},
		{"three decimals", -1234567, "KWD", 3, "-KWD 1,234.567"},
		{"exactly three digits", 99900, "USD", 2, "$999.00"},
		{"four digits", 100000, "USD", 2, "$1,000.00"},
		{"min int64 does not panic", math.MinInt64 + 1, "INR", 2, "-₹92,233,720,368,547,758.07"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.m.Display(tt.currency, tt.decimals); got != tt.want {
				t.Fatalf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestBasisPoints(t *testing.T) {
	tests := []struct {
		name     string
		num, den int64
		want     int64
	}{
		{"half", 1, 2, 5000},
		{"third rounds down", 1, 3, 3333},
		{"two thirds rounds up", 2, 3, 6667},
		{"over 100 percent", 3, 2, 15000},
		{"negative numerator", -1, 3, -3333},
		{"negative rounds away from zero", -2, 3, -6667},
		{"negative denominator", 1, -4, -2500},
		{"zero denominator", 5, 0, 0},
		{"large values do not overflow", math.MaxInt64 / 2, math.MaxInt64, 5000},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := BasisPoints(tt.num, tt.den); got != tt.want {
				t.Fatalf("got %d, want %d", got, tt.want)
			}
		})
	}
}

func TestFormatBasisPoints(t *testing.T) {
	tests := []struct {
		bp       int64
		showPlus bool
		want     string
	}{
		{1234, false, "12.34%"},
		{1234, true, "+12.34%"},
		{-1234, true, "-12.34%"},
		{5, true, "+0.05%"},
		{-5, false, "-0.05%"},
		{0, true, "0.00%"},
		{10000, false, "100.00%"},
	}
	for _, tt := range tests {
		if got := FormatBasisPoints(tt.bp, tt.showPlus); got != tt.want {
			t.Errorf("FormatBasisPoints(%d, %v) = %q, want %q", tt.bp, tt.showPlus, got, tt.want)
		}
	}
}

func TestDivideRounded(t *testing.T) {
	tests := []struct {
		m    Money
		n    int64
		want Money
	}{
		{100, 3, 33},
		{200, 3, 67},
		{5, 2, 3},
		{-5, 2, -3},
		{-100, 3, -33},
		{100, 0, 0},
		{0, 5, 0},
	}
	for _, tt := range tests {
		if got := tt.m.DivideRounded(tt.n); got != tt.want {
			t.Errorf("Money(%d).DivideRounded(%d) = %d, want %d", tt.m, tt.n, got, tt.want)
		}
	}
}

func TestIntentValid(t *testing.T) {
	for _, valid := range []Intent{IntentNone, IntentNeed, IntentWant, IntentImpulse} {
		if !valid.Valid() {
			t.Errorf("%q should be valid", valid)
		}
	}
	if Intent("hobby").Valid() {
		t.Error("unknown intent should be invalid")
	}
}

func TestProjectCategoryHelpers(t *testing.T) {
	p := Project{Categories: []Category{{Name: "food", Color: "#111111"}}}

	added := p.WithCategory("rent", "#222222")
	recoloured := added.WithCategory("food", "#333333")
	archived, ok := recoloured.WithArchived("rent", true)
	_, missing := archived.WithArchived("nope", true)

	if len(p.Categories) != 1 || p.Categories[0].Color != "#111111" {
		t.Fatalf("the original project must not change: %+v", p.Categories)
	}
	if len(added.Categories) != 2 || recoloured.Categories[0].Color != "#333333" {
		t.Fatalf("added = %+v, recoloured = %+v", added.Categories, recoloured.Categories)
	}
	if !ok || !archived.Categories[1].Archived || recoloured.Categories[1].Archived || missing {
		t.Fatalf("archived = %+v, ok = %v, missing = %v", archived.Categories, ok, missing)
	}
	if !archived.KnownCategory("rent") || archived.CategoryColor("food") != "#333333" || archived.CategoryColor("nope") != "" {
		t.Fatal("archived categories stay known")
	}
}

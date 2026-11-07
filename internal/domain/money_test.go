package domain

import (
	"errors"
	"math"
	"testing"
)

func TestParseMoney(t *testing.T) {
	tests := []struct {
		name     string
		in       string
		decimals int
		want     Money
		wantErr  bool
	}{
		{"two decimals", "12.50", 2, 1250, false},
		{"negative", "-120.00", 2, -12000, false},
		{"explicit plus", "+2500.00", 2, 250000, false},
		{"fewer digits than places", "12.5", 2, 1250, false},
		{"no point", "12", 2, 1200, false},
		{"zero decimals", "1500", 0, 1500, false},
		{"three decimals", "-1.005", 3, -1005, false},
		{"leading zeros", "007.05", 2, 705, false},
		{"zero", "0.00", 2, 0, false},
		{"negative zero", "-0", 2, 0, false},
		{"max int64", "9223372036854775807", 0, math.MaxInt64, false},
		{"too many digits for places", "1.005", 2, 0, true},
		{"fraction with zero places", "1.0", 0, 0, true},
		{"overflow", "9223372036854775808", 0, 0, true},
		{"overflow with decimals", "92233720368547758.08", 2, 0, true},
		{"empty", "", 2, 0, true},
		{"sign only", "-", 2, 0, true},
		{"double sign", "--1", 2, 0, true},
		{"mixed signs", "+-1", 2, 0, true},
		{"no whole part", ".50", 2, 0, true},
		{"trailing point", "12.", 2, 0, true},
		{"letters", "abc", 2, 0, true},
		{"thousands separator", "1,000.00", 2, 0, true},
		{"comma decimal", "12,50", 2, 0, true},
		{"spaces", " 12.50", 2, 0, true},
		{"exponent", "1e3", 2, 0, true},
		{"negative places", "1", -1, 0, true},
		{"too many places", "1", 19, 0, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseMoney(tt.in, tt.decimals)
			if tt.wantErr {
				if !errors.Is(err, ErrInvalidMoney) {
					t.Fatalf("ParseMoney(%q, %d) error = %v, want ErrInvalidMoney", tt.in, tt.decimals, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseMoney(%q, %d) unexpected error: %v", tt.in, tt.decimals, err)
			}
			if got != tt.want {
				t.Fatalf("ParseMoney(%q, %d) = %d, want %d", tt.in, tt.decimals, got, tt.want)
			}
		})
	}
}

func TestMoneyFormat(t *testing.T) {
	tests := []struct {
		name     string
		m        Money
		decimals int
		want     string
	}{
		{"two decimals", 1250, 2, "12.50"},
		{"negative", -12000, 2, "-120.00"},
		{"zero", 0, 2, "0.00"},
		{"under one unit", 5, 2, "0.05"},
		{"negative under one unit", -5, 2, "-0.05"},
		{"zero decimals", 1500, 0, "1500"},
		{"three decimals", -1005, 3, "-1.005"},
		{"min int64", math.MinInt64, 0, "-9223372036854775808"},
		{"max int64", math.MaxInt64, 2, "92233720368547758.07"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.m.Format(tt.decimals); got != tt.want {
				t.Fatalf("Money(%d).Format(%d) = %q, want %q", tt.m, tt.decimals, got, tt.want)
			}
		})
	}
}

func TestMoneyRoundTrip(t *testing.T) {
	for _, decimals := range []int{0, 2, 3} {
		for _, m := range []Money{0, 1, -1, 99, 100, -12345, math.MaxInt64, math.MinInt64 + 1} {
			got, err := ParseMoney(m.Format(decimals), decimals)
			if err != nil || got != m {
				t.Fatalf("round trip of %d with %d decimals = %d, %v", m, decimals, got, err)
			}
		}
	}
}

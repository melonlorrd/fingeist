package domain

import (
	"errors"
	"testing"
)

func TestParseDecimalAndString(t *testing.T) {
	tests := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"684.797", "684.797", false},
		{"0.5", "0.5", false},
		{"0.05", "0.05", false},
		{"12", "12", false},
		{"12.50", "12.50", false},
		{"007.10", "7.10", false},
		{"0.00000001", "0.00000001", false},
		{"1.123456789", "", true},
		{"-1", "", true},
		{"+1", "", true},
		{"", "", true},
		{".5", "", true},
		{"5.", "", true},
		{"1e3", "", true},
		{"1,5", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			got, err := ParseDecimal(tt.in)
			if tt.wantErr {
				if !errors.Is(err, ErrInvalidDecimal) {
					t.Fatalf("error = %v, want ErrInvalidDecimal", err)
				}
				return
			}
			if err != nil || got.String() != tt.want {
				t.Fatalf("got %q, %v; want %q", got.String(), err, tt.want)
			}
		})
	}
}

func TestDecimalZeroValue(t *testing.T) {
	var d Decimal
	if d.String() != "0" || !d.IsZero() {
		t.Fatalf("zero value = %q", d.String())
	}
}

func TestDecimalEqual(t *testing.T) {
	parse := func(s string) Decimal {
		d, err := ParseDecimal(s)
		if err != nil {
			t.Fatal(err)
		}
		return d
	}
	if !parse("12.50").Equal(parse("12.5")) || !parse("0").Equal(Decimal{}) || parse("12.5").Equal(parse("12.51")) {
		t.Fatal("Equal compares values, not text")
	}
}

func TestDecimalTimes(t *testing.T) {
	tests := []struct {
		name     string
		units    string
		price    string
		decimals int
		want     Money
	}{
		{"fractional units", "684.797", "52.3417", 2, 3584344},
		{"whole numbers", "10", "250", 2, 250000},
		{"rounds half up", "1", "0.005", 2, 1},
		{"rounds down", "1", "0.004", 2, 0},
		{"zero decimals", "3", "1.5", 0, 5},
		{"three decimals", "2", "1.2345", 3, 2469},
		{"zero units", "0", "99.99", 2, 0},
		{"gold grams", "12.5", "7250.40", 2, 9063000},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			units, _ := ParseDecimal(tt.units)
			price, _ := ParseDecimal(tt.price)
			got, err := units.Times(price, tt.decimals)
			if err != nil || got != tt.want {
				t.Fatalf("got %d, %v; want %d", got, err, tt.want)
			}
		})
	}
}

func TestDecimalTimesOverflow(t *testing.T) {
	big, _ := ParseDecimal("99999999999999999999")
	if _, err := big.Times(big, 2); err == nil {
		t.Fatal("expected an overflow error")
	}
}

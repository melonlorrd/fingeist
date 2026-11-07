package domain

import (
	"fmt"
	"math/big"
	"strings"
)

var currencySymbols = map[string]string{
	"INR": "₹",
	"USD": "$",
	"EUR": "€",
	"GBP": "£",
	"JPY": "¥",
}

// CurrencyPrefix is the symbol for well-known currencies, else the code and a space.
func CurrencyPrefix(currency string) string {
	if symbol, ok := currencySymbols[currency]; ok {
		return symbol
	}
	return currency + " "
}

// Display formats an amount with the currency symbol and thousands grouping, e.g. -₹1,234.50.
func (m Money) Display(currency string, decimals int) string {
	text := m.Format(decimals)
	sign := ""
	if strings.HasPrefix(text, "-") {
		sign, text = "-", text[1:]
	}
	whole, fraction, hasPoint := strings.Cut(text, ".")
	result := sign + CurrencyPrefix(currency) + groupThousands(whole)
	if hasPoint {
		result += "." + fraction
	}
	return result
}

// BasisPoints returns num/den in hundredths of a percent, rounded half away from zero.
func BasisPoints(num, den int64) int64 {
	if den == 0 {
		return 0
	}
	scaled := new(big.Int).Mul(big.NewInt(num), big.NewInt(10000))
	divisor := big.NewInt(den)
	quotient, remainder := new(big.Int).QuoRem(scaled, divisor, new(big.Int))

	twiceRemainder := new(big.Int).Abs(remainder.Mul(remainder, big.NewInt(2)))
	if twiceRemainder.Cmp(new(big.Int).Abs(divisor)) >= 0 {
		if (scaled.Sign() < 0) != (divisor.Sign() < 0) {
			quotient.Sub(quotient, big.NewInt(1))
		} else {
			quotient.Add(quotient, big.NewInt(1))
		}
	}
	return quotient.Int64()
}

// FormatBasisPoints renders hundredths of a percent as "12.34%", with a leading + when showPlus is set.
func FormatBasisPoints(bp int64, showPlus bool) string {
	sign := ""
	switch {
	case bp < 0:
		sign, bp = "-", -bp
	case showPlus && bp > 0:
		sign = "+"
	}
	return fmt.Sprintf("%s%d.%02d%%", sign, bp/100, bp%100)
}

func groupThousands(digits string) string {
	var grouped strings.Builder
	for i, digit := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			grouped.WriteByte(',')
		}
		grouped.WriteRune(digit)
	}
	return grouped.String()
}

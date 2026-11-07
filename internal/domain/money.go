package domain

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Money is an amount in minor units (cents for 2 decimals). Negative is an expense.
type Money int64

// MaxDecimals is the most decimal places an int64 amount can sensibly carry.
const MaxDecimals = 18

var ErrInvalidMoney = errors.New("invalid amount")

// ParseMoney reads an exact decimal such as "-12.50" using the given number of decimal places.
func ParseMoney(s string, decimals int) (Money, error) {
	if decimals < 0 || decimals > MaxDecimals {
		return 0, fmt.Errorf("%w: unsupported decimal places %d", ErrInvalidMoney, decimals)
	}
	negative := strings.HasPrefix(s, "-")
	digits := strings.TrimLeft(s, "+-")
	if len(s)-len(digits) > 1 {
		return 0, fmt.Errorf("%w: %q", ErrInvalidMoney, s)
	}

	whole, fraction, hasPoint := strings.Cut(digits, ".")
	if !isDigits(whole) || (hasPoint && !isDigits(fraction)) || len(fraction) > decimals {
		return 0, fmt.Errorf("%w: %q", ErrInvalidMoney, s)
	}

	minor, err := strconv.ParseUint(whole+fraction+strings.Repeat("0", decimals-len(fraction)), 10, 63)
	if err != nil {
		return 0, fmt.Errorf("%w: %q: %w", ErrInvalidMoney, s, err)
	}
	if negative {
		return -Money(minor), nil
	}
	return Money(minor), nil
}

// Format renders the amount with exactly the given number of decimal places.
func (m Money) Format(decimals int) string {
	sign := ""
	magnitude := uint64(m)
	if m < 0 {
		sign = "-"
		magnitude = -magnitude
	}
	if decimals == 0 {
		return sign + strconv.FormatUint(magnitude, 10)
	}

	scale := uint64(math.Pow10(decimals))
	return fmt.Sprintf("%s%d.%0*d", sign, magnitude/scale, decimals, magnitude%scale)
}

func isDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// DivideRounded divides by n, rounding half away from zero.
func (m Money) DivideRounded(n int64) Money {
	if n <= 0 {
		return 0
	}
	quotient, remainder := int64(m)/n, int64(m)%n
	if remainder < 0 {
		remainder = -remainder
	}
	if remainder*2 >= n {
		if m < 0 {
			quotient--
		} else {
			quotient++
		}
	}
	return Money(quotient)
}

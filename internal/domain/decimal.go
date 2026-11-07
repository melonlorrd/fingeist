package domain

import (
	"errors"
	"fmt"
	"math/big"
	"strings"
)

const maxDecimalPlaces = 8

var ErrInvalidDecimal = errors.New("invalid number")

// Decimal is an exact non-negative decimal such as a unit quantity or a unit price.
type Decimal struct {
	digits *big.Int
	scale  int
}

// ParseDecimal reads an exact decimal such as "684.797".
func ParseDecimal(s string) (Decimal, error) {
	whole, fraction, hasPoint := strings.Cut(s, ".")
	if !isDigits(whole) || (hasPoint && !isDigits(fraction)) || len(fraction) > maxDecimalPlaces {
		return Decimal{}, fmt.Errorf("%w: %q", ErrInvalidDecimal, s)
	}
	digits, _ := new(big.Int).SetString(whole+fraction, 10)
	return Decimal{digits: digits, scale: len(fraction)}, nil
}

// String keeps the number of decimal places it was parsed with.
func (d Decimal) String() string {
	if d.digits == nil {
		return "0"
	}
	text := d.digits.String()
	if d.scale == 0 {
		return text
	}
	if len(text) <= d.scale {
		text = strings.Repeat("0", d.scale-len(text)+1) + text
	}
	return text[:len(text)-d.scale] + "." + text[len(text)-d.scale:]
}

func (d Decimal) IsZero() bool {
	return d.digits == nil || d.digits.Sign() == 0
}

// Equal compares values, ignoring trailing zeros.
func (d Decimal) Equal(other Decimal) bool {
	a, b := d.digitsOrZero(), other.digitsOrZero()
	left := new(big.Int).Mul(a, pow10(other.scale))
	right := new(big.Int).Mul(b, pow10(d.scale))
	return left.Cmp(right) == 0
}

// Times multiplies two decimals and rounds half up to the given number of money decimal places.
func (d Decimal) Times(other Decimal, decimals int) (Money, error) {
	product := new(big.Int).Mul(d.digitsOrZero(), other.digitsOrZero())
	scale := d.scale + other.scale

	if scale > decimals {
		divisor := pow10(scale - decimals)
		quotient, remainder := new(big.Int).QuoRem(product, divisor, new(big.Int))
		if remainder.Mul(remainder, big.NewInt(2)).Cmp(divisor) >= 0 {
			quotient.Add(quotient, big.NewInt(1))
		}
		product = quotient
	} else {
		product.Mul(product, pow10(decimals-scale))
	}

	if !product.IsInt64() {
		return 0, fmt.Errorf("%w: %s times %s is too large", ErrInvalidMoney, d, other)
	}
	return Money(product.Int64()), nil
}

func (d Decimal) digitsOrZero() *big.Int {
	if d.digits == nil {
		return new(big.Int)
	}
	return d.digits
}

func pow10(n int) *big.Int {
	return new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(n)), nil)
}

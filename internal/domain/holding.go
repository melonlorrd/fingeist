package domain

import "time"

type AssetClass string

const (
	ClassMutualFund AssetClass = "mutual_fund"
	ClassEquity     AssetClass = "equity"
	ClassGold       AssetClass = "gold"
)

// AssetClasses lists the classes in display order.
var AssetClasses = []AssetClass{ClassMutualFund, ClassEquity, ClassGold}

func (c AssetClass) Valid() bool {
	for _, known := range AssetClasses {
		if c == known {
			return true
		}
	}
	return false
}

func (c AssetClass) Label() string {
	switch c {
	case ClassMutualFund:
		return "Mutual funds"
	case ClassEquity:
		return "Equity"
	case ClassGold:
		return "Gold"
	}
	return string(c)
}

const (
	PriceSourceManual = "manual"
	PriceSourceAMFI   = "amfi"
	PriceSourceYahoo  = "yahoo"
)

// Holding is one investment. Units are grams for gold. PriceAsOf is zero until a price was set or fetched.
type Holding struct {
	ID           string
	Class        AssetClass
	Name         string
	Ticker       string
	Units        Decimal
	AvgBuyPrice  Decimal
	CurrentPrice Decimal
	PriceAsOf    time.Time
	PriceSource  string
	Notes        string
}

// Quote is a fetched price.
type Quote struct {
	Price  Decimal
	AsOf   time.Time
	Source string
}

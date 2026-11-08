package storage

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"fingeist/internal/domain"
)

// HoldingFields is a holding as text, the same shape as a CSV row and as the edit form.
type HoldingFields struct {
	ID           string `json:"id"`
	Class        string `json:"class"`
	Name         string `json:"name"`
	Ticker       string `json:"ticker"`
	Units        string `json:"units"`
	AvgBuyPrice  string `json:"avgBuyPrice"`
	CurrentPrice string `json:"currentPrice"`
	PriceAsOf    string `json:"priceAsOf"`
	PriceSource  string `json:"priceSource"`
	Notes        string `json:"notes"`
}

var holdingHeaders = [][]string{
	{"id", "class", "name", "ticker", "units", "avg_buy_price", "current_price", "price_as_of", "price_source", "notes"},
}

func holdingFormat() format[domain.Holding] {
	return format[domain.Holding]{
		headers: holdingHeaders,
		decode: func(_ int, r []string) (domain.Holding, error) {
			return HoldingFields{ID: r[0], Class: r[1], Name: r[2], Ticker: r[3], Units: r[4], AvgBuyPrice: r[5],
				CurrentPrice: r[6], PriceAsOf: r[7], PriceSource: r[8], Notes: r[9]}.toHolding()
		},
		encode: func(h domain.Holding) []string {
			f := holdingFieldsOf(h)
			return []string{f.ID, f.Class, f.Name, f.Ticker, f.Units, f.AvgBuyPrice, f.CurrentPrice, f.PriceAsOf, f.PriceSource, f.Notes}
		},
		id: func(h *domain.Holding) *string { return &h.ID },
	}
}

func (f HoldingFields) toHolding() (domain.Holding, error) {
	class := domain.AssetClass(strings.TrimSpace(f.Class))
	if !class.Valid() {
		return domain.Holding{}, fmt.Errorf("invalid class %q: use mutual_fund, equity or gold", f.Class)
	}
	name := strings.TrimSpace(f.Name)
	if name == "" {
		return domain.Holding{}, fmt.Errorf("name is required")
	}
	units, err := domain.ParseDecimal(strings.TrimSpace(f.Units))
	if err != nil {
		return domain.Holding{}, fmt.Errorf("units: %w", err)
	}
	avgBuy, err := domain.ParseDecimal(strings.TrimSpace(f.AvgBuyPrice))
	if err != nil {
		return domain.Holding{}, fmt.Errorf("average buy price: %w", err)
	}

	current := avgBuy
	if text := strings.TrimSpace(f.CurrentPrice); text != "" {
		if current, err = domain.ParseDecimal(text); err != nil {
			return domain.Holding{}, fmt.Errorf("current price: %w", err)
		}
	}

	var asOf time.Time
	if text := strings.TrimSpace(f.PriceAsOf); text != "" {
		if asOf, err = time.Parse(time.RFC3339, text); err != nil {
			return domain.Holding{}, fmt.Errorf("invalid price_as_of %q: use 2026-11-07T14:30:00+05:30", text)
		}
	}
	source := strings.TrimSpace(f.PriceSource)
	if !slices.Contains([]string{"", domain.PriceSourceManual, domain.PriceSourceAMFI, domain.PriceSourceYahoo}, source) {
		return domain.Holding{}, fmt.Errorf("invalid price_source %q", source)
	}

	return domain.Holding{
		ID: strings.TrimSpace(f.ID), Class: class, Name: name, Ticker: strings.TrimSpace(f.Ticker),
		Units: units, AvgBuyPrice: avgBuy, CurrentPrice: current,
		PriceAsOf: asOf, PriceSource: source, Notes: f.Notes,
	}, nil
}

func holdingFieldsOf(h domain.Holding) HoldingFields {
	asOf := ""
	if !h.PriceAsOf.IsZero() {
		asOf = h.PriceAsOf.Format(time.RFC3339)
	}
	return HoldingFields{
		ID: h.ID, Class: string(h.Class), Name: h.Name, Ticker: h.Ticker,
		Units: h.Units.String(), AvgBuyPrice: h.AvgBuyPrice.String(), CurrentPrice: h.CurrentPrice.String(),
		PriceAsOf: asOf, PriceSource: h.PriceSource, Notes: h.Notes,
	}
}

// HoldingStore holds one project's investments in memory and keeps holdings.csv in step.
type HoldingStore struct {
	*store[domain.Holding]
}

func OpenHoldings(path string) (*HoldingStore, error) {
	s, err := openStore(path, holdingFormat())
	if err != nil {
		return nil, err
	}
	return &HoldingStore{store: s}, nil
}

// Holdings returns a copy of the loaded holdings.
func (h *HoldingStore) Holdings() []domain.Holding {
	return slices.Clone(h.items)
}

// Get returns one holding as text.
func (h *HoldingStore) Get(id string) (HoldingFields, error) {
	holding, ok := h.find(id)
	if !ok {
		return HoldingFields{}, ErrNotFound
	}
	return holdingFieldsOf(holding), nil
}

// Add appends a holding under a new id and saves. A blank current price starts at the buy price.
func (h *HoldingStore) Add(f HoldingFields) error {
	if err := h.checkEditable(); err != nil {
		return err
	}
	f.ID, f.PriceAsOf, f.PriceSource = NewID(), "", ""
	holding, err := f.toHolding()
	if err != nil {
		return err
	}
	if strings.TrimSpace(f.CurrentPrice) != "" {
		holding.PriceAsOf, holding.PriceSource = h.now(), domain.PriceSourceManual
	}
	return h.append(holding)
}

// Update replaces the holding with the same id and saves. A changed current price counts as set by hand.
func (h *HoldingStore) Update(f HoldingFields) error {
	if err := h.checkEditable(); err != nil {
		return err
	}
	existing, ok := h.find(strings.TrimSpace(f.ID))
	if !ok {
		return ErrNotFound
	}
	holding, err := f.toHolding()
	if err != nil {
		return err
	}

	holding.PriceAsOf, holding.PriceSource = existing.PriceAsOf, existing.PriceSource
	if !holding.CurrentPrice.Equal(existing.CurrentPrice) {
		holding.PriceAsOf, holding.PriceSource = h.now(), domain.PriceSourceManual
	}
	return h.replace(holding.ID, holding)
}

// Delete removes the holding with the given id and saves.
func (h *HoldingStore) Delete(id string) error {
	return h.remove(id)
}

// ApplyQuotes sets fetched prices by holding id and saves.
func (h *HoldingStore) ApplyQuotes(quotes map[string]domain.Quote) error {
	if err := h.checkEditable(); err != nil {
		return err
	}
	for i := range h.items {
		if quote, ok := quotes[h.items[i].ID]; ok {
			h.items[i].CurrentPrice, h.items[i].PriceAsOf, h.items[i].PriceSource = quote.Price, quote.AsOf, quote.Source
		}
	}
	return h.save()
}

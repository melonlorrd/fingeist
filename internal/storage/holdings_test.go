package storage

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"fingeist/internal/domain"
)

const holdingsHeader = "id,class,name,ticker,units,avg_buy_price,current_price,price_as_of,price_source,notes\n"

func openTestHoldings(t *testing.T, content string) (*HoldingStore, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "holdings.csv")
	if content != "" {
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	h, err := OpenHoldings(path)
	if err != nil {
		t.Fatal(err)
	}
	h.now = func() time.Time { return time.Date(2026, 11, 8, 10, 0, 0, 0, time.UTC) }
	return h, path
}

func TestHoldingsLoadKeepsExactUnits(t *testing.T) {
	h, _ := openTestHoldings(t, holdingsHeader+"h1,mutual_fund,Index fund,119551,684.797,52.3417,55.10,2026-11-07T00:00:00+05:30,amfi,folio 123\n")
	if len(h.Problems()) != 0 || len(h.Holdings()) != 1 {
		t.Fatalf("problems = %v, holdings = %d", h.Problems(), len(h.Holdings()))
	}
	got, _ := h.Get("h1")
	if got.Units != "684.797" || got.AvgBuyPrice != "52.3417" || got.CurrentPrice != "55.10" || got.PriceSource != "amfi" {
		t.Fatalf("got %+v", got)
	}
}

func TestHoldingsBlankCurrentPriceDefaultsToBuyPrice(t *testing.T) {
	h, _ := openTestHoldings(t, holdingsHeader+"h1,equity,Acme,ACME.NS,10,250.50,,,,\n")
	got, _ := h.Get("h1")
	if got.CurrentPrice != "250.50" || got.PriceAsOf != "" {
		t.Fatalf("got %+v", got)
	}
}

func TestHoldingsMalformedRows(t *testing.T) {
	h, path := openTestHoldings(t, holdingsHeader+
		"h1,equity,Acme,,10,250,,,,\n"+
		"h2,bond,Gov bond,,1,100,,,,\n"+
		"h3,gold,,,5,6000,,,,\n"+
		"h4,gold,Coins,,-5,6000,,,,\n"+
		"h5,gold,Coins,,5,6000,,not a time,,\n"+
		"h6,gold,Coins,,5,6000,,,ebay,\n"+
		"h7,gold,Coins\n")
	if len(h.Holdings()) != 1 || len(h.Problems()) != 6 {
		t.Fatalf("holdings = %d, problems = %+v", len(h.Holdings()), h.Problems())
	}
	before := readFile(t, path)
	if err := h.Add(HoldingFields{Class: "gold", Name: "x", Units: "1", AvgBuyPrice: "1"}); !errors.Is(err, ErrMalformedRows) {
		t.Fatalf("error = %v, want ErrMalformedRows", err)
	}
	if readFile(t, path) != before {
		t.Fatal("a file with malformed rows must not be rewritten")
	}
}

func TestHoldingsAddUpdateDelete(t *testing.T) {
	h, path := openTestHoldings(t, "")

	if err := h.Add(HoldingFields{ID: "ignored", Class: "gold", Name: "Coins", Units: "12.5", AvgBuyPrice: "6000", Notes: "locker"}); err != nil {
		t.Fatal(err)
	}
	id := h.Holdings()[0].ID
	if id == "" || id == "ignored" {
		t.Fatalf("id = %q", id)
	}
	got, _ := h.Get(id)
	if got.CurrentPrice != "6000" || got.PriceSource != "" || got.PriceAsOf != "" {
		t.Fatalf("a blank current price must not look like a priced holding: %+v", got)
	}

	got.Notes = "bank locker"
	if err := h.Update(got); err != nil {
		t.Fatal(err)
	}
	if again, _ := h.Get(id); again.PriceSource != "" || again.Notes != "bank locker" {
		t.Fatalf("an unchanged price must not count as set by hand: %+v", again)
	}

	got.CurrentPrice = "6500.50"
	if err := h.Update(got); err != nil {
		t.Fatal(err)
	}
	again, _ := h.Get(id)
	if again.PriceSource != "manual" || again.PriceAsOf != "2026-11-08T10:00:00Z" {
		t.Fatalf("a changed price counts as manual: %+v", again)
	}
	if !strings.Contains(readFile(t, path), id+",gold,Coins,,12.5,6000,6500.50,2026-11-08T10:00:00Z,manual,bank locker") {
		t.Fatalf("file = %q", readFile(t, path))
	}

	if err := h.Update(HoldingFields{ID: "nope", Class: "gold", Name: "x", Units: "1", AvgBuyPrice: "1"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("error = %v", err)
	}
	if err := h.Delete(id); err != nil || len(h.Holdings()) != 0 {
		t.Fatalf("delete: %v, %d left", err, len(h.Holdings()))
	}
}

func TestHoldingsRejectBadInput(t *testing.T) {
	h, path := openTestHoldings(t, "")
	for _, f := range []HoldingFields{
		{Class: "gold", Name: "x", Units: "abc", AvgBuyPrice: "1"},
		{Class: "gold", Name: "x", Units: "1", AvgBuyPrice: ""},
		{Class: "gold", Name: "x", Units: "1", AvgBuyPrice: "1", CurrentPrice: "-3"},
		{Class: "gold", Name: " ", Units: "1", AvgBuyPrice: "1"},
		{Class: "crypto", Name: "x", Units: "1", AvgBuyPrice: "1"},
		{Class: "gold", Name: "x", Units: "1.123456789", AvgBuyPrice: "1"},
	} {
		if err := h.Add(f); err == nil {
			t.Errorf("Add(%+v) succeeded, want an error", f)
		}
	}
	if _, err := os.Stat(path); err == nil {
		t.Fatal("invalid input must not create the file")
	}
}

func TestHoldingsApplyQuotes(t *testing.T) {
	h, _ := openTestHoldings(t, holdingsHeader+"h1,equity,Acme,ACME.NS,10,250,250,,,\nh2,gold,Coins,,5,6000,6000,,,\n")
	price, _ := domain.ParseDecimal("261.4")
	asOf := time.Date(2026, 11, 7, 10, 0, 0, 0, time.UTC)

	if err := h.ApplyQuotes(map[string]domain.Quote{"h1": {Price: price, AsOf: asOf, Source: domain.PriceSourceYahoo}}); err != nil {
		t.Fatal(err)
	}
	h1, _ := h.Get("h1")
	h2, _ := h.Get("h2")
	if h1.CurrentPrice != "261.4" || h1.PriceSource != "yahoo" || h2.CurrentPrice != "6000" {
		t.Fatalf("h1 = %+v, h2 = %+v", h1, h2)
	}
}

func TestHoldingsExternalChange(t *testing.T) {
	h, path := openTestHoldings(t, holdingsHeader+"h1,equity,Acme,,10,250,,,,\n")
	edited := holdingsHeader + "h1,equity,Acme,,10,250,,,,\nh2,gold,Coins,,5,6000,,,,\n"
	if err := os.WriteFile(path, []byte(edited), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := h.Delete("h1"); !errors.Is(err, ErrExternalChange) {
		t.Fatalf("error = %v, want ErrExternalChange", err)
	}
	if readFile(t, path) != edited || len(h.Holdings()) != 2 {
		t.Fatal("the externally edited file must be reloaded, not overwritten")
	}
}

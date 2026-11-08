package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"el-costas/internal/config"
	"el-costas/internal/prices"
	"el-costas/internal/report"
	"el-costas/internal/storage"
)

func newTestApp(t *testing.T) (*App, string) {
	t.Helper()
	home := t.TempDir()
	return &App{ctx: context.Background(), folders: config.Folders{Config: home, Data: home}, sources: prices.DefaultSources()}, home
}

func newTestProject(t *testing.T) (*App, string) {
	t.Helper()
	app, home := newTestApp(t)
	if err := app.CreateProject("Home", "inr", 2, []string{"food", " rent "}); err != nil {
		t.Fatal(err)
	}
	return app, filepath.Join(home, "projects", "home")
}

func TestSampleProjectLoads(t *testing.T) {
	app := &App{ctx: context.Background(), folders: config.Folders{Config: t.TempDir(), Data: filepath.Join("data", "sample")}, sources: prices.DefaultSources()}
	if err := app.loadProject("household"); err != nil {
		t.Fatal(err)
	}

	boot, err := app.Bootstrap()
	if err != nil || len(boot.Problems) != 0 || len(boot.HoldingProblems) != 0 || boot.Currency != "INR" {
		t.Fatalf("boot = %+v, err = %v", boot, err)
	}

	data, err := app.Dashboard("", "")
	if err != nil || len(data.Charts) != 9 || len(data.Summary.Cards) != 4 {
		t.Fatalf("charts = %d, cards = %d, err = %v", len(data.Charts), len(data.Summary.Cards), err)
	}
	for _, chart := range data.Charts {
		if chart.Error != "" {
			t.Errorf("chart %q: %s", chart.Title, chart.Error)
		}
	}
	if data.Charts[0].Months[0].Month != "2026-08" {
		t.Errorf("first month = %s", data.Charts[0].Months[0].Month)
	}

	october, err := app.Dashboard("2026-10-01", "2026-10-31")
	if err != nil || len(october.Charts[0].Months) != 1 {
		t.Fatalf("months = %d, err = %v", len(october.Charts[0].Months), err)
	}
	if _, err := app.Dashboard("garbage", ""); err == nil {
		t.Fatal("expected an error for a bad date")
	}

	ledger, err := app.Ledger(report.LedgerQuery{Month: "2026-10", Filter: "expense"})
	if err != nil || ledger.Count == 0 || len(ledger.Months) < 4 {
		t.Fatalf("ledger = %+v, err = %v", ledger, err)
	}

	view, err := app.Portfolio()
	if err != nil || len(view.Holdings) == 0 || view.PortfolioValue == "" {
		t.Fatalf("portfolio = %+v, err = %v", view, err)
	}
}

func TestFirstRunToFirstTransaction(t *testing.T) {
	app, home := newTestApp(t)

	boot, err := app.Bootstrap()
	if err != nil || !boot.NeedsSetup {
		t.Fatalf("boot = %+v, err = %v; want setup", boot, err)
	}
	if err := app.AddTransaction(storage.Fields{Time: "2026-01-02", Amount: "-1"}); err == nil {
		t.Fatal("adding without a project must fail")
	}

	if err := app.CreateProject("Home", "inr", 2, []string{"food", " rent "}); err != nil {
		t.Fatal(err)
	}
	if err := app.CreateProject("Other", "usd", 2, nil); err == nil {
		t.Fatal("a second project must be refused in the MVP")
	}

	boot, err = app.Bootstrap()
	if err != nil || boot.ProjectName != "Home" || boot.Currency != "INR" || len(boot.Categories) != 2 || boot.Categories[1].Name != "rent" || boot.Categories[0].Color == "" {
		t.Fatalf("boot = %+v, err = %v", boot, err)
	}
	if len(boot.Settings.Workdays) != 5 || len(boot.Settings.SmallPurchaseThresholds) != 4 {
		t.Fatalf("settings = %+v", boot.Settings)
	}

	if err := app.AddTransaction(storage.Fields{Time: "2026-01-02 09:30", Amount: "-12.5", Category: "food", Merchant: "Shop", Intent: "need"}); err != nil {
		t.Fatal(err)
	}
	ledger, err := app.Ledger(report.LedgerQuery{})
	if err != nil || ledger.Count != 1 || ledger.Days[0].Rows[0].Amount.Text != "-₹12.50" {
		t.Fatalf("ledger = %+v, err = %v", ledger, err)
	}

	row, err := app.GetTransaction(ledger.Days[0].Rows[0].ID)
	if err != nil || row.Intent != "need" {
		t.Fatalf("row = %+v, err = %v", row, err)
	}
	row.Amount = "-20"
	if err := app.UpdateTransaction(row); err != nil {
		t.Fatal(err)
	}
	if err := app.DeleteTransaction(row.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(home, "projects", "home", "backups")); err != nil {
		t.Fatalf("saving over an existing file should leave backups: %v", err)
	}
}

func TestSettingsAndCategoriesPersist(t *testing.T) {
	app, dir := newTestProject(t)

	settings := config.SettingsOf(app.project)
	settings.Name = "Our home"
	settings.SmallPurchaseThresholds = []string{"50", "150"}
	settings.Workdays = []string{"mon", "tue"}
	settings.TargetAllocation = map[string]int{"equity": 70, "gold": 30}
	settings.Currency = "USD"
	if err := app.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	if err := app.SaveSettings(config.Settings{Name: "x"}); err == nil {
		t.Fatal("settings without workdays must be rejected")
	}
	if err := app.SaveCategory(" travel ", "#123abc"); err != nil {
		t.Fatal(err)
	}
	if err := app.SaveCategory("food", "#ff0000"); err != nil {
		t.Fatal(err)
	}
	if err := app.SetCategoryArchived("rent", true); err != nil {
		t.Fatal(err)
	}
	if err := app.SetCategoryArchived("nope", true); err == nil {
		t.Fatal("unknown category must be rejected")
	}
	if err := app.SaveCategory("bad", "red"); err == nil {
		t.Fatal("a bad colour must be rejected")
	}

	reloaded, err := config.LoadProject(filepath.Join(dir, "project.toml"))
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Name != "Our home" || reloaded.Currency != "INR" || len(reloaded.Categories) != 3 {
		t.Fatalf("reloaded = %+v", reloaded)
	}
	if reloaded.Categories[0].Color != "#ff0000" || !reloaded.Categories[1].Archived || reloaded.Categories[2].Name != "travel" {
		t.Fatalf("categories = %+v", reloaded.Categories)
	}
	if len(reloaded.Workdays) != 2 || reloaded.TargetAllocation["equity"] != 70 {
		t.Fatalf("settings were not saved: %+v", reloaded)
	}
	if entries, _ := os.ReadDir(filepath.Join(dir, "backups")); len(entries) == 0 {
		t.Fatal("saving project.toml should leave a backup")
	}
}

func TestProjectFileEditedOutsideTheApp(t *testing.T) {
	app, dir := newTestProject(t)
	path := filepath.Join(dir, "project.toml")

	content, _ := os.ReadFile(path)
	edited := strings.Replace(string(content), `name = "Home"`, `name = "Edited by hand"`, 1)
	if err := os.WriteFile(path, []byte(edited), 0o600); err != nil {
		t.Fatal(err)
	}

	err := app.SaveCategory("travel", "#123abc")
	if err == nil || !strings.Contains(err.Error(), "reloaded") {
		t.Fatalf("error = %v, want a reload message", err)
	}
	if app.project.Name != "Edited by hand" || len(app.project.Categories) != 2 {
		t.Fatalf("project = %+v", app.project)
	}
	if after, _ := os.ReadFile(path); string(after) != edited {
		t.Fatal("the hand-edited file must not be overwritten")
	}

	if err := os.WriteFile(path, []byte(strings.Replace(edited, "Edited by hand", "Again", 1)), 0o600); err != nil {
		t.Fatal(err)
	}
	changed, err := app.CheckForChanges()
	if err != nil || !changed || app.project.Name != "Again" {
		t.Fatalf("changed = %v, err = %v, name = %q", changed, err, app.project.Name)
	}
	if changed, _ := app.CheckForChanges(); changed {
		t.Fatal("nothing changed since the reload")
	}
}

func TestCheckForChangesCoversTransactionsAndHoldings(t *testing.T) {
	app, dir := newTestProject(t)
	if err := app.AddTransaction(storage.Fields{Time: "2026-01-02", Amount: "-1"}); err != nil {
		t.Fatal(err)
	}
	if err := app.AddHolding(storage.HoldingFields{Class: "gold", Name: "Coins", Units: "5", AvgBuyPrice: "6000"}); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(dir, "transactions.csv"), []byte("id,time,amount,category,merchant,note,tags,intent\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if changed, err := app.CheckForChanges(); err != nil || !changed || app.ledger.Balance() != 0 {
		t.Fatalf("transactions: changed = %v, err = %v", changed, err)
	}

	if err := os.WriteFile(filepath.Join(dir, "holdings.csv"), []byte("id,class,name,ticker,units,avg_buy_price,current_price,price_as_of,price_source,notes\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if changed, err := app.CheckForChanges(); err != nil || !changed || len(app.holdings.Holdings()) != 0 {
		t.Fatalf("holdings: changed = %v, err = %v", changed, err)
	}
}

func TestHoldingsAndPriceUpdates(t *testing.T) {
	app, _ := newTestProject(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/v8/finance/chart/GOOD.NS") {
			w.Write([]byte(`{"chart":{"result":[{"meta":{"regularMarketPrice":261.4,"regularMarketTime":1794139800}}],"error":null}}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()
	app.sources = prices.Sources{AMFIURL: srv.URL + "/NAVAll.txt", YahooURL: srv.URL, Client: srv.Client()}

	for _, f := range []storage.HoldingFields{
		{Class: "equity", Name: "Good Co", Ticker: "GOOD.NS", Units: "10", AvgBuyPrice: "250"},
		{Class: "equity", Name: "Missing Co", Ticker: "MISSING.NS", Units: "5", AvgBuyPrice: "100"},
		{Class: "gold", Name: "Coins", Units: "12.5", AvgBuyPrice: "6000"},
	} {
		if err := app.AddHolding(f); err != nil {
			t.Fatal(err)
		}
	}

	result, err := app.UpdatePrices()
	if err != nil || result.Updated != 1 || len(result.Failures) != 1 || result.Failures[0].Name != "Missing Co" {
		t.Fatalf("result = %+v, err = %v", result, err)
	}

	view, err := app.Portfolio()
	if err != nil {
		t.Fatal(err)
	}
	var good, missing bool
	for _, row := range view.Holdings {
		switch row.Name {
		case "Good Co":
			good = row.CurrentPrice == "₹261.4" && row.PriceSource == "yahoo" && row.Gain == "₹114.00"
		case "Missing Co":
			missing = row.CurrentPrice == "₹100" && row.OutOfDate
		}
	}
	if !good || !missing {
		t.Fatalf("rows = %+v", view.Holdings)
	}

	id := view.Holdings[0].ID
	if err := app.DeleteHolding(id); err != nil {
		t.Fatal(err)
	}
	if _, err := app.GetHolding(id); err == nil {
		t.Fatal("deleted holding should be gone")
	}
}

func TestPresetRangeBinding(t *testing.T) {
	app, _ := newTestApp(t)
	if r, err := app.PresetRange("all_time"); err != nil || r.From != "" || r.To != "" {
		t.Fatalf("all_time = %+v, %v", r, err)
	}
	if r, err := app.PresetRange("this_month"); err != nil || !strings.HasSuffix(r.From, "-01") || r.To != today() {
		t.Fatalf("this_month = %+v, %v", r, err)
	}
	if _, err := app.PresetRange("whenever"); err == nil {
		t.Fatal("unknown preset must fail")
	}
}

func TestOpenProjectFolderNeedsAProject(t *testing.T) {
	app, _ := newTestApp(t)
	if err := app.OpenProjectFolder(); err == nil {
		t.Fatal("expected an error without a project")
	}
}

package main

import (
	"os"
	"path/filepath"
	"testing"

	"el-costas/internal/config"
	"el-costas/internal/storage"
)

func TestSampleProjectLoads(t *testing.T) {
	app := &App{folders: config.Folders{Config: t.TempDir(), Data: filepath.Join("data", "sample")}}
	if err := app.loadProject("household"); err != nil {
		t.Fatal(err)
	}

	state, err := app.State("", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Problems) != 0 || len(state.Rows) == 0 || len(state.Charts) != 3 {
		t.Fatalf("problems = %v, rows = %d, charts = %d", state.Problems, len(state.Rows), len(state.Charts))
	}
	for _, chart := range state.Charts {
		if chart.Error != "" {
			t.Errorf("chart %q: %s", chart.Title, chart.Error)
		}
	}
	if state.Charts[0].Months[0].Month != "2026-08" {
		t.Errorf("first month = %s", state.Charts[0].Months[0].Month)
	}

	filtered, err := app.State("2026-10-01", "2026-10-31")
	if err != nil {
		t.Fatal(err)
	}
	if len(filtered.Rows) == 0 || len(filtered.Rows) >= len(state.Rows) || len(filtered.Charts[0].Months) != 1 {
		t.Fatalf("filtered rows = %d of %d, months = %d", len(filtered.Rows), len(state.Rows), len(filtered.Charts[0].Months))
	}
	if _, err := app.State("garbage", ""); err == nil {
		t.Fatal("expected an error for a bad date")
	}
}

func TestFirstRunToFirstTransaction(t *testing.T) {
	home := t.TempDir()
	app := &App{folders: config.Folders{Config: home, Data: home}}

	state, err := app.State("", "")
	if err != nil || !state.NeedsSetup {
		t.Fatalf("state = %+v, err = %v; want setup", state, err)
	}
	if err := app.AddTransaction(storage.Fields{Time: "2026-01-02", Amount: "-1"}); err == nil {
		t.Fatal("adding without a project must fail")
	}

	if err := app.CreateProject("Home", "usd", 2, []string{"food"}); err != nil {
		t.Fatal(err)
	}
	if err := app.CreateProject("Other", "usd", 2, nil); err == nil {
		t.Fatal("a second project must be refused in the MVP")
	}

	if err := app.AddTransaction(storage.Fields{Time: "2026-01-02 09:30", Amount: "-12.5", Category: "food", Merchant: "Shop"}); err != nil {
		t.Fatal(err)
	}
	state, err = app.State("", "")
	if err != nil || state.ProjectName != "Home" || state.Currency != "USD" || len(state.Rows) != 1 {
		t.Fatalf("state = %+v, err = %v", state, err)
	}
	if got := state.Charts[1].Categories; len(got) != 1 || got[0].Spent.Text != "12.50 USD" {
		t.Fatalf("categories = %+v", got)
	}

	row := state.Rows[0]
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

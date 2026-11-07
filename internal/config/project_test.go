package config

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"el-costas/internal/domain"
)

func TestSlug(t *testing.T) {
	tests := map[string]string{
		"Household":        "household",
		"My Small  Shop!":  "my-small-shop",
		"  --Café 2026-- ": "caf-2026",
		"???":              "project",
		"":                 "project",
	}
	for in, want := range tests {
		if got := Slug(in); got != want {
			t.Errorf("Slug(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCreateProjectRoundTrip(t *testing.T) {
	folders := Folders{Config: t.TempDir(), Data: t.TempDir()}
	in := domain.Project{Name: " Household ", Currency: "usd ", Decimals: 2, Categories: []domain.Category{{Name: "groceries"}, {Name: "rent", Color: "#112233"}}}

	slug, err := CreateProject(folders, in)
	if err != nil || slug != "household" {
		t.Fatalf("slug = %q, err = %v", slug, err)
	}

	got, err := LoadProject(folders.ProjectFile(slug))
	want := defaultSettings(domain.Project{Name: "Household", Currency: "USD", Decimals: 2, Categories: []domain.Category{{Name: "groceries", Color: "#2a78d6"}, {Name: "rent", Color: "#112233"}}})
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, %v; want %+v", got, err, want)
	}

	charts, err := LoadDashboard(filepath.Join(folders.ProjectDir(slug), "dashboard.toml"))
	if err != nil || len(charts) != 9 || charts[0].Type != domain.ChartMonthlyTotals {
		t.Fatalf("charts = %+v, err = %v", charts, err)
	}
}

func TestCreateProjectZeroDecimalsRoundTrip(t *testing.T) {
	folders := Folders{Config: t.TempDir(), Data: t.TempDir()}
	slug, err := CreateProject(folders, domain.Project{Name: "Tokyo", Currency: "JPY", Decimals: 0})
	if err != nil {
		t.Fatal(err)
	}
	got, err := LoadProject(folders.ProjectFile(slug))
	if err != nil || got.Decimals != 0 || got.Currency != "JPY" {
		t.Fatalf("got %+v, %v", got, err)
	}
}

func TestCreateProjectRejects(t *testing.T) {
	tests := []struct {
		name string
		p    domain.Project
	}{
		{"blank name", domain.Project{Name: " ", Currency: "USD", Decimals: 2}},
		{"blank currency", domain.Project{Name: "A", Currency: "", Decimals: 2}},
		{"negative decimals", domain.Project{Name: "A", Currency: "USD", Decimals: -1}},
		{"too many decimals", domain.Project{Name: "A", Currency: "USD", Decimals: domain.MaxDecimals + 1}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			folders := Folders{Config: t.TempDir(), Data: t.TempDir()}
			if _, err := CreateProject(folders, tt.p); err == nil {
				t.Fatal("expected an error")
			}
			if _, err := os.Stat(filepath.Join(folders.Data, "projects")); err == nil {
				t.Fatal("an invalid project must not create folders")
			}
		})
	}
}

func TestCreateProjectNeverOverwrites(t *testing.T) {
	folders := Folders{Config: t.TempDir(), Data: t.TempDir()}
	p := domain.Project{Name: "Home", Currency: "USD", Decimals: 2}
	slug, err := CreateProject(folders, p)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(folders.ProjectFile(slug))

	p.Currency = "EUR"
	if _, err := CreateProject(folders, p); err == nil {
		t.Fatal("expected an error for an existing project")
	}
	after, _ := os.ReadFile(folders.ProjectFile(slug))
	if string(before) != string(after) {
		t.Fatal("existing project.toml was changed")
	}
}

func TestLoadDashboard(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    []domain.ChartDef
		wantErr bool
	}{
		{"two charts", "[[charts]]\ntitle = \"A\"\ntype = \"by_category\"\n[[charts]]\ntitle = \"B\"\ntype = \"monthly_totals\"", []domain.ChartDef{{Title: "A", Type: "by_category"}, {Title: "B", Type: "monthly_totals"}}, false},
		{"no charts", ``, []domain.ChartDef{}, false},
		{"missing title", "[[charts]]\ntype = \"by_category\"", nil, true},
		{"missing type", "[[charts]]\ntitle = \"A\"", nil, true},
		{"invalid toml", "[[charts]", nil, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := LoadDashboard(writeFile(t, tt.content))
			if (err != nil) != tt.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr && !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestChooseProject(t *testing.T) {
	makeProject := func(t *testing.T, f Folders, slug string) {
		t.Helper()
		if err := os.MkdirAll(f.ProjectDir(slug), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(f.ProjectFile(slug), []byte("name = \"x\""), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	setLast := func(t *testing.T, f Folders, slug string) {
		t.Helper()
		if err := os.WriteFile(f.AppFile(), []byte("last_project = \""+slug+"\""), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	tests := []struct {
		name      string
		setup     func(t *testing.T, f Folders)
		wantSlug  string
		wantFound bool
	}{
		{"nothing exists", func(t *testing.T, f Folders) {}, "", false},
		{"first project alphabetically", func(t *testing.T, f Folders) {
			makeProject(t, f, "zeta")
			makeProject(t, f, "alpha")
		}, "alpha", true},
		{"last project wins", func(t *testing.T, f Folders) {
			makeProject(t, f, "alpha")
			makeProject(t, f, "zeta")
			setLast(t, f, "zeta")
		}, "zeta", true},
		{"stale last project falls back", func(t *testing.T, f Folders) {
			makeProject(t, f, "alpha")
			setLast(t, f, "gone")
		}, "alpha", true},
		{"folders without project.toml are skipped", func(t *testing.T, f Folders) {
			if err := os.MkdirAll(f.ProjectDir("empty"), 0o755); err != nil {
				t.Fatal(err)
			}
			makeProject(t, f, "real")
		}, "real", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			folders := Folders{Config: t.TempDir(), Data: t.TempDir()}
			tt.setup(t, folders)
			slug, found, err := ChooseProject(folders)
			if err != nil || slug != tt.wantSlug || found != tt.wantFound {
				t.Fatalf("got %q, %v, %v; want %q, %v", slug, found, err, tt.wantSlug, tt.wantFound)
			}
		})
	}
}

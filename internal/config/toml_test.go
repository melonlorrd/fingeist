package config

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"fingeist/internal/domain"
)

func writeFile(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "file.toml")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLoadApp(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    App
		wantErr bool
	}{
		{"last project", `last_project = "household"`, App{LastProject: "household"}, false},
		{"empty file", ``, App{}, false},
		{"unknown keys ignored", "theme = \"dark\"\nlast_project = \"a\"", App{LastProject: "a"}, false},
		{"invalid toml", `last_project = `, App{}, true},
		{"wrong type", `last_project = 3`, App{}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := LoadApp(writeFile(t, tt.content))
			if (err != nil) != tt.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, tt.wantErr)
			}
			if got != tt.want {
				t.Fatalf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestLoadAppMissingFile(t *testing.T) {
	got, err := LoadApp(filepath.Join(t.TempDir(), "app.toml"))
	if err != nil || got != (App{}) {
		t.Fatalf("got %+v, %v; want empty App and no error", got, err)
	}
}

func defaultSettings(p domain.Project) domain.Project {
	p.SmallPurchaseThresholds = []domain.Money{10000, 25000, 50000, 100000}
	p.Workdays = []time.Weekday{time.Monday, time.Tuesday, time.Wednesday, time.Thursday, time.Friday}
	return p
}

func TestLoadProject(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    domain.Project
		wantErr bool
	}{
		{
			name: "full with defaults filled in",
			content: `name = "Household"
currency = "USD"
decimals = 2
schema_version = 1
categories = ["groceries", "transport"]`,
			want: defaultSettings(domain.Project{Name: "Household", Currency: "USD", Decimals: 2, Categories: []domain.Category{
				{Name: "groceries", Color: "#2a78d6"}, {Name: "transport", Color: "#eb6834"},
			}}),
		},
		{
			name:    "zero decimals scale the default thresholds",
			content: "name = \"Tokyo\"\ncurrency = \"JPY\"\ndecimals = 0",
			want: domain.Project{Name: "Tokyo", Currency: "JPY", Decimals: 0,
				SmallPurchaseThresholds: []domain.Money{100, 250, 500, 1000},
				Workdays:                []time.Weekday{time.Monday, time.Tuesday, time.Wednesday, time.Thursday, time.Friday}},
		},
		{
			name: "colours archived thresholds workdays targets",
			content: `name = "A"
currency = "INR"
decimals = 2
categories = ["food", "old"]
archived_categories = ["old"]
small_purchase_thresholds = ["50", "99.50"]
workdays = ["Mon", "sat"]
[category_colors]
food = "#AABBCC"
[target_allocation]
mutual_fund = 60
equity = 30
gold = 10`,
			want: domain.Project{Name: "A", Currency: "INR", Decimals: 2,
				Categories:              []domain.Category{{Name: "food", Color: "#aabbcc"}, {Name: "old", Color: "#eb6834", Archived: true}},
				SmallPurchaseThresholds: []domain.Money{5000, 9950},
				Workdays:                []time.Weekday{time.Monday, time.Saturday},
				TargetAllocation:        map[domain.AssetClass]int{domain.ClassMutualFund: 60, domain.ClassEquity: 30, domain.ClassGold: 10}},
		},
		{name: "missing name", content: "currency = \"USD\"\ndecimals = 2", wantErr: true},
		{name: "missing currency", content: "name = \"A\"\ndecimals = 2", wantErr: true},
		{name: "missing decimals", content: "name = \"A\"\ncurrency = \"USD\"", wantErr: true},
		{name: "negative decimals", content: "name = \"A\"\ncurrency = \"USD\"\ndecimals = -1", wantErr: true},
		{name: "invalid toml", content: "name = ", wantErr: true},
		{name: "empty file", content: ``, wantErr: true},
		{name: "bad colour", content: "name = \"A\"\ncurrency = \"USD\"\ndecimals = 2\ncategories = [\"a\"]\n[category_colors]\na = \"red\"", wantErr: true},
		{name: "duplicate category", content: "name = \"A\"\ncurrency = \"USD\"\ndecimals = 2\ncategories = [\"a\", \"a\"]", wantErr: true},
		{name: "bad threshold", content: "name = \"A\"\ncurrency = \"USD\"\ndecimals = 2\nsmall_purchase_thresholds = [\"ten\"]", wantErr: true},
		{name: "zero threshold", content: "name = \"A\"\ncurrency = \"USD\"\ndecimals = 2\nsmall_purchase_thresholds = [\"0\"]", wantErr: true},
		{name: "bad weekday", content: "name = \"A\"\ncurrency = \"USD\"\ndecimals = 2\nworkdays = [\"funday\"]", wantErr: true},
		{name: "targets not 100", content: "name = \"A\"\ncurrency = \"USD\"\ndecimals = 2\n[target_allocation]\nequity = 50", wantErr: true},
		{name: "unknown target class", content: "name = \"A\"\ncurrency = \"USD\"\ndecimals = 2\n[target_allocation]\nbonds = 100", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := LoadProject(writeFile(t, tt.content))
			if (err != nil) != tt.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, tt.wantErr)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %+v\nwant %+v", got, tt.want)
			}
		})
	}
}

func TestEncodeProjectRoundTrip(t *testing.T) {
	in := domain.Project{Name: "A", Currency: "INR", Decimals: 2,
		Categories:              []domain.Category{{Name: "food", Color: "#aabbcc"}, {Name: "old", Color: "#112233", Archived: true}},
		SmallPurchaseThresholds: []domain.Money{5000, 9950},
		Workdays:                []time.Weekday{time.Sunday, time.Monday},
		TargetAllocation:        map[domain.AssetClass]int{domain.ClassEquity: 70, domain.ClassGold: 30}}

	data, err := EncodeProject(in)
	if err != nil {
		t.Fatal(err)
	}
	got, err := LoadProject(writeFile(t, string(data)))
	if err != nil || !reflect.DeepEqual(got, in) {
		t.Fatalf("got %+v, %v\nwant %+v\nfile:\n%s", got, err, in, data)
	}
}

func TestEncodeProjectRejectsInvalid(t *testing.T) {
	valid := domain.Project{Name: "A", Currency: "INR", Decimals: 2, Workdays: []time.Weekday{time.Monday}}
	tests := map[string]func(*domain.Project){
		"no workdays":     func(p *domain.Project) { p.Workdays = nil },
		"zero threshold":  func(p *domain.Project) { p.SmallPurchaseThresholds = []domain.Money{0} },
		"blank category":  func(p *domain.Project) { p.Categories = []domain.Category{{Name: " ", Color: "#112233"}} },
		"bad colour":      func(p *domain.Project) { p.Categories = []domain.Category{{Name: "a", Color: "blue"}} },
		"targets not 100": func(p *domain.Project) { p.TargetAllocation = map[domain.AssetClass]int{domain.ClassEquity: 99} },
		"target over 100": func(p *domain.Project) { p.TargetAllocation = map[domain.AssetClass]int{domain.ClassEquity: 101} },
		"blank name":      func(p *domain.Project) { p.Name = "" },
	}
	if _, err := EncodeProject(valid); err != nil {
		t.Fatalf("valid project rejected: %v", err)
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			p := valid
			mutate(&p)
			if _, err := EncodeProject(p); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}

func TestLoadProjectMissingFile(t *testing.T) {
	if _, err := LoadProject(filepath.Join(t.TempDir(), "project.toml")); err == nil {
		t.Fatal("expected an error for a missing project.toml")
	}
}

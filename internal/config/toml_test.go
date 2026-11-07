package config

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"el-costas/internal/domain"
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

func TestLoadProject(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    domain.Project
		wantErr bool
	}{
		{
			name: "full",
			content: `name = "Household"
currency = "USD"
decimals = 2
schema_version = 1
categories = ["groceries", "transport"]`,
			want: domain.Project{Name: "Household", Currency: "USD", Decimals: 2, Categories: []string{"groceries", "transport"}},
		},
		{
			name:    "zero decimals",
			content: "name = \"Tokyo\"\ncurrency = \"JPY\"\ndecimals = 0",
			want:    domain.Project{Name: "Tokyo", Currency: "JPY", Decimals: 0},
		},
		{name: "missing name", content: "currency = \"USD\"\ndecimals = 2", wantErr: true},
		{name: "missing currency", content: "name = \"A\"\ndecimals = 2", wantErr: true},
		{name: "missing decimals", content: "name = \"A\"\ncurrency = \"USD\"", wantErr: true},
		{name: "negative decimals", content: "name = \"A\"\ncurrency = \"USD\"\ndecimals = -1", wantErr: true},
		{name: "invalid toml", content: "name = ", wantErr: true},
		{name: "empty file", content: ``, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := LoadProject(writeFile(t, tt.content))
			if (err != nil) != tt.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, tt.wantErr)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestLoadProjectMissingFile(t *testing.T) {
	if _, err := LoadProject(filepath.Join(t.TempDir(), "project.toml")); err == nil {
		t.Fatal("expected an error for a missing project.toml")
	}
}

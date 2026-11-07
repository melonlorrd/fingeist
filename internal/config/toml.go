package config

import (
	"errors"
	"fmt"
	"io/fs"
	"strings"

	"github.com/BurntSushi/toml"

	"el-costas/internal/domain"
)

// App is the content of app.toml.
type App struct {
	LastProject string `toml:"last_project"`
}

type projectFile struct {
	SchemaVersion int      `toml:"schema_version"`
	Name          string   `toml:"name"`
	Currency      string   `toml:"currency"`
	Decimals      *int     `toml:"decimals"`
	Categories    []string `toml:"categories"`
}

type dashboardFile struct {
	Charts []chartFile `toml:"charts"`
}

type chartFile struct {
	Title string `toml:"title"`
	Type  string `toml:"type"`
}

// LoadApp reads app.toml. A missing file is a first run and gives an empty App.
func LoadApp(path string) (App, error) {
	var app App
	if _, err := toml.DecodeFile(path, &app); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return App{}, fmt.Errorf("load %s: %w", path, err)
	}
	return app, nil
}

// LoadProject reads project.toml.
func LoadProject(path string) (domain.Project, error) {
	var file projectFile
	if _, err := toml.DecodeFile(path, &file); err != nil {
		return domain.Project{}, fmt.Errorf("load %s: %w", path, err)
	}

	if file.Decimals == nil {
		return domain.Project{}, fmt.Errorf("load %s: decimals is required", path)
	}
	project := domain.Project{
		Name:       file.Name,
		Currency:   file.Currency,
		Decimals:   *file.Decimals,
		Categories: file.Categories,
	}
	if err := validateProject(project); err != nil {
		return domain.Project{}, fmt.Errorf("load %s: %w", path, err)
	}
	return project, nil
}

// LoadDashboard reads dashboard.toml.
func LoadDashboard(path string) ([]domain.ChartDef, error) {
	var file dashboardFile
	if _, err := toml.DecodeFile(path, &file); err != nil {
		return nil, fmt.Errorf("load %s: %w", path, err)
	}

	charts := make([]domain.ChartDef, len(file.Charts))
	for i, c := range file.Charts {
		if c.Title == "" || c.Type == "" {
			return nil, fmt.Errorf("load %s: chart %d needs a title and a type", path, i+1)
		}
		charts[i] = domain.ChartDef{Title: c.Title, Type: c.Type}
	}
	return charts, nil
}

func validateProject(p domain.Project) error {
	switch {
	case strings.TrimSpace(p.Name) == "":
		return errors.New("name is required")
	case strings.TrimSpace(p.Currency) == "":
		return errors.New("currency is required")
	case p.Decimals < 0 || p.Decimals > domain.MaxDecimals:
		return fmt.Errorf("decimals must be between 0 and %d", domain.MaxDecimals)
	}
	return nil
}

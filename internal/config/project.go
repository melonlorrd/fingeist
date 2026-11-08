package config

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"fingeist/internal/domain"
)

const projectFileName = "project.toml"

const defaultDashboard = `[[charts]]
title = "Monthly totals"
type = "monthly_totals"

[[charts]]
title = "Spending by category"
type = "by_category"

[[charts]]
title = "Daily spending"
type = "calendar_heatmap"

[[charts]]
title = "Running balance"
type = "running_balance"

[[charts]]
title = "Spending by intent"
type = "intent_trends"

[[charts]]
title = "Small purchases"
type = "small_purchases"

[[charts]]
title = "Workday routine"
type = "workday_routine"

[[charts]]
title = "Weekday and hour"
type = "weekday_hour_heatmap"

[[charts]]
title = "No-spend days"
type = "no_spend_calendar"
`

var nonSlugChars = regexp.MustCompile(`[^a-z0-9]+`)

// Slug turns a project name into a folder name.
func Slug(name string) string {
	slug := strings.Trim(nonSlugChars.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if slug == "" {
		return "project"
	}
	return slug
}

// ProjectFile is the path of a project's project.toml.
func (f Folders) ProjectFile(slug string) string {
	return filepath.Join(f.ProjectDir(slug), projectFileName)
}

// ChooseProject picks the project to open: the one in app.toml, else the first one found.
func ChooseProject(f Folders) (slug string, found bool, err error) {
	app, err := LoadApp(f.AppFile())
	if err != nil {
		return "", false, err
	}
	if app.LastProject != "" && fileExists(f.ProjectFile(app.LastProject)) {
		return app.LastProject, true, nil
	}

	entries, err := os.ReadDir(filepath.Join(f.Data, "projects"))
	if errors.Is(err, fs.ErrNotExist) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("list projects: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	slices.Sort(names)
	for _, name := range names {
		if fileExists(f.ProjectFile(name)) {
			return name, true, nil
		}
	}
	return "", false, nil
}

// CreateProject writes project.toml and a default dashboard.toml for a new project and returns its slug.
func CreateProject(f Folders, p domain.Project) (string, error) {
	p = withDefaults(p)
	if err := validateProject(p); err != nil {
		return "", err
	}

	slug := Slug(p.Name)
	dir := f.ProjectDir(slug)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create project folder: %w", err)
	}

	content, err := EncodeProject(p)
	if err != nil {
		return "", err
	}
	if err := writeNew(filepath.Join(dir, projectFileName), string(content)); err != nil {
		return "", err
	}
	if err := writeNew(filepath.Join(dir, "dashboard.toml"), defaultDashboard); err != nil {
		return "", err
	}
	return slug, nil
}

func withDefaults(p domain.Project) domain.Project {
	p.Name = strings.TrimSpace(p.Name)
	p.Currency = strings.ToUpper(strings.TrimSpace(p.Currency))
	for i := range p.Categories {
		if p.Categories[i].Color == "" {
			p.Categories[i].Color = defaultCategoryColors[i%len(defaultCategoryColors)]
		}
	}
	if len(p.SmallPurchaseThresholds) == 0 {
		for _, text := range defaultThresholds {
			amount, err := domain.ParseMoney(text, p.Decimals)
			if err == nil {
				p.SmallPurchaseThresholds = append(p.SmallPurchaseThresholds, amount)
			}
		}
	}
	if len(p.Workdays) == 0 {
		p.Workdays = defaultWorkdays
	}
	return p
}

func writeNew(path, content string) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if errors.Is(err, fs.ErrExist) {
		return fmt.Errorf("%s already exists", path)
	}
	if err != nil {
		return fmt.Errorf("create %s: %w", path, err)
	}
	if _, err := file.WriteString(content); err != nil {
		file.Close()
		return fmt.Errorf("write %s: %w", path, err)
	}
	return file.Close()
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

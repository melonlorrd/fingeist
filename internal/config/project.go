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

	"github.com/BurntSushi/toml"

	"el-costas/internal/domain"
)

const (
	projectSchemaVersion = 1
	projectFileName      = "project.toml"
)

const defaultDashboard = `[[charts]]
title = "Monthly totals"
type = "monthly_totals"

[[charts]]
title = "Spending by category"
type = "by_category"

[[charts]]
title = "Daily spending"
type = "calendar_heatmap"
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
	p.Name = strings.TrimSpace(p.Name)
	p.Currency = strings.ToUpper(strings.TrimSpace(p.Currency))
	if err := validateProject(p); err != nil {
		return "", err
	}

	slug := Slug(p.Name)
	dir := f.ProjectDir(slug)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create project folder: %w", err)
	}

	var content strings.Builder
	err := toml.NewEncoder(&content).Encode(projectFile{
		SchemaVersion: projectSchemaVersion,
		Name:          p.Name,
		Currency:      p.Currency,
		Decimals:      &p.Decimals,
		Categories:    p.Categories,
	})
	if err != nil {
		return "", fmt.Errorf("encode project: %w", err)
	}
	if err := writeNew(filepath.Join(dir, projectFileName), content.String()); err != nil {
		return "", err
	}
	if err := writeNew(filepath.Join(dir, "dashboard.toml"), defaultDashboard); err != nil {
		return "", err
	}
	return slug, nil
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

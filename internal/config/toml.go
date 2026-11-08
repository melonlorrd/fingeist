package config

import (
	"errors"
	"fmt"
	"io/fs"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/BurntSushi/toml"

	"fingeist/internal/domain"
)

const projectSchemaVersion = 1

var (
	weekdayNames = []string{"sun", "mon", "tue", "wed", "thu", "fri", "sat"}
	colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

	defaultThresholds = []string{"100", "250", "500", "1000"}
	defaultWorkdays   = []time.Weekday{time.Monday, time.Tuesday, time.Wednesday, time.Thursday, time.Friday}

	defaultCategoryColors = []string{
		"#2a78d6", "#eb6834", "#1baf7a", "#eda100",
		"#e87ba4", "#008300", "#6250d6", "#e34948",
	}
)

// App is the content of app.toml.
type App struct {
	LastProject string `toml:"last_project"`
}

type projectFile struct {
	SchemaVersion           int               `toml:"schema_version"`
	Name                    string            `toml:"name"`
	Currency                string            `toml:"currency"`
	Decimals                *int              `toml:"decimals"`
	Categories              []string          `toml:"categories"`
	ArchivedCategories      []string          `toml:"archived_categories,omitempty"`
	SmallPurchaseThresholds []string          `toml:"small_purchase_thresholds,omitempty"`
	Workdays                []string          `toml:"workdays,omitempty"`
	CategoryColors          map[string]string `toml:"category_colors,omitempty"`
	TargetAllocation        map[string]int    `toml:"target_allocation,omitempty"`
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

// LoadProject reads project.toml and fills in defaults for the optional settings.
func LoadProject(path string) (domain.Project, error) {
	var file projectFile
	if _, err := toml.DecodeFile(path, &file); err != nil {
		return domain.Project{}, fmt.Errorf("load %s: %w", path, err)
	}
	project, err := file.toProject()
	if err != nil {
		return domain.Project{}, fmt.Errorf("load %s: %w", path, err)
	}
	return project, nil
}

// EncodeProject renders project.toml after validating the project.
func EncodeProject(p domain.Project) ([]byte, error) {
	if err := validateProject(p); err != nil {
		return nil, err
	}
	var content strings.Builder
	if err := toml.NewEncoder(&content).Encode(fileOf(p)); err != nil {
		return nil, fmt.Errorf("encode project: %w", err)
	}
	return []byte(content.String()), nil
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

func (f projectFile) toProject() (domain.Project, error) {
	if f.Decimals == nil {
		return domain.Project{}, errors.New("decimals is required")
	}
	p := domain.Project{Name: f.Name, Currency: f.Currency, Decimals: *f.Decimals}
	if err := validateIdentity(p); err != nil {
		return domain.Project{}, err
	}

	for i, name := range f.Categories {
		color := f.CategoryColors[name]
		if color == "" {
			color = defaultCategoryColors[i%len(defaultCategoryColors)]
		}
		p.Categories = append(p.Categories, domain.Category{
			Name: name, Color: strings.ToLower(color), Archived: slices.Contains(f.ArchivedCategories, name),
		})
	}

	thresholds := f.SmallPurchaseThresholds
	if len(thresholds) == 0 {
		thresholds = defaultThresholds
	}
	for _, text := range thresholds {
		amount, err := domain.ParseMoney(text, p.Decimals)
		if err != nil {
			return domain.Project{}, fmt.Errorf("small_purchase_thresholds: %w", err)
		}
		p.SmallPurchaseThresholds = append(p.SmallPurchaseThresholds, amount)
	}

	p.Workdays = defaultWorkdays
	if len(f.Workdays) > 0 {
		p.Workdays = nil
		for _, name := range f.Workdays {
			day := slices.Index(weekdayNames, strings.ToLower(name))
			if day < 0 {
				return domain.Project{}, fmt.Errorf("workdays: unknown day %q, use mon, tue, wed, thu, fri, sat or sun", name)
			}
			p.Workdays = append(p.Workdays, time.Weekday(day))
		}
	}

	if len(f.TargetAllocation) > 0 {
		p.TargetAllocation = map[domain.AssetClass]int{}
		for class, percent := range f.TargetAllocation {
			p.TargetAllocation[domain.AssetClass(class)] = percent
		}
	}

	if err := validateProject(p); err != nil {
		return domain.Project{}, err
	}
	return p, nil
}

func fileOf(p domain.Project) projectFile {
	file := projectFile{
		SchemaVersion: projectSchemaVersion,
		Name:          p.Name,
		Currency:      p.Currency,
		Decimals:      &p.Decimals,
		Categories:    []string{},
	}
	for _, c := range p.Categories {
		file.Categories = append(file.Categories, c.Name)
		if c.Archived {
			file.ArchivedCategories = append(file.ArchivedCategories, c.Name)
		}
		if file.CategoryColors == nil {
			file.CategoryColors = map[string]string{}
		}
		file.CategoryColors[c.Name] = c.Color
	}
	for _, threshold := range p.SmallPurchaseThresholds {
		file.SmallPurchaseThresholds = append(file.SmallPurchaseThresholds, threshold.Format(p.Decimals))
	}
	for _, day := range p.Workdays {
		file.Workdays = append(file.Workdays, weekdayNames[day])
	}
	if len(p.TargetAllocation) > 0 {
		file.TargetAllocation = map[string]int{}
		for class, percent := range p.TargetAllocation {
			file.TargetAllocation[string(class)] = percent
		}
	}
	return file
}

func validateIdentity(p domain.Project) error {
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

func validateProject(p domain.Project) error {
	if err := validateIdentity(p); err != nil {
		return err
	}
	if err := validateCategories(p.Categories); err != nil {
		return err
	}
	for _, threshold := range p.SmallPurchaseThresholds {
		if threshold <= 0 {
			return errors.New("small-purchase thresholds must be above zero")
		}
	}
	if len(p.Workdays) == 0 {
		return errors.New("pick at least one workday")
	}
	return validateTargets(p.TargetAllocation)
}

func validateCategories(categories []domain.Category) error {
	seen := map[string]bool{}
	for _, c := range categories {
		switch {
		case strings.TrimSpace(c.Name) == "":
			return errors.New("category names cannot be blank")
		case seen[c.Name]:
			return fmt.Errorf("category %q is listed twice", c.Name)
		case !colorPattern.MatchString(c.Color):
			return fmt.Errorf("category %q: colour %q must look like #2f6f9f", c.Name, c.Color)
		}
		seen[c.Name] = true
	}
	return nil
}

func validateTargets(targets map[domain.AssetClass]int) error {
	if len(targets) == 0 {
		return nil
	}
	total := 0
	for class, percent := range targets {
		if !class.Valid() {
			return fmt.Errorf("target_allocation: unknown asset class %q", class)
		}
		if percent < 0 || percent > 100 {
			return fmt.Errorf("target_allocation: %s must be between 0 and 100", class)
		}
		total += percent
	}
	if total != 100 {
		return fmt.Errorf("target allocation must add up to 100, not %d", total)
	}
	return nil
}

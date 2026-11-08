package main

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"el-costas/internal/config"
	"el-costas/internal/domain"
	"el-costas/internal/portfolio"
	"el-costas/internal/prices"
	"el-costas/internal/report"
	"el-costas/internal/storage"
)

const (
	nowLayout          = "2006-01-02 15:04"
	priceUpdateTimeout = time.Minute
)

var errNoProject = errors.New("no project is open")

// App is bound to the frontend; each method is a thin wrapper over the internal packages.
type App struct {
	ctx      context.Context
	folders  config.Folders
	sources  prices.Sources
	startErr error

	project     domain.Project
	projectPath string
	projectHash string
	dashboard   []domain.ChartDef
	ledger      *storage.Ledger
	holdings    *storage.HoldingStore
}

type CategoryView struct {
	Name     string `json:"name"`
	Color    string `json:"color"`
	Archived bool   `json:"archived"`
}

// Boot is the project's header data: what the frontend needs on every screen.
type Boot struct {
	NeedsSetup      bool              `json:"needsSetup"`
	ProjectName     string            `json:"projectName"`
	Currency        string            `json:"currency"`
	Categories      []CategoryView    `json:"categories"`
	Settings        config.Settings   `json:"settings"`
	Now             string            `json:"now"`
	Today           string            `json:"today"`
	Problems        []storage.Problem `json:"problems"`
	Unsaved         bool              `json:"unsaved"`
	HoldingProblems []storage.Problem `json:"holdingProblems"`
	HoldingsUnsaved bool              `json:"holdingsUnsaved"`
}

type DashboardData struct {
	Summary report.Summary `json:"summary"`
	Charts  []report.Chart `json:"charts"`
}

type Range struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type PriceUpdate struct {
	Updated  int              `json:"updated"`
	Failures []prices.Failure `json:"failures"`
}

func NewApp() *App {
	return &App{sources: prices.DefaultSources()}
}

func (a *App) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	a.ctx = ctx
	a.startErr = a.openProject()
	return nil
}

func (a *App) Bootstrap() (Boot, error) {
	if a.startErr != nil {
		return Boot{}, a.startErr
	}
	if a.ledger == nil {
		return Boot{NeedsSetup: true}, nil
	}

	categories := make([]CategoryView, len(a.project.Categories))
	for i, c := range a.project.Categories {
		categories[i] = CategoryView{Name: c.Name, Color: c.Color, Archived: c.Archived}
	}
	return Boot{
		ProjectName:     a.project.Name,
		Currency:        a.project.Currency,
		Categories:      categories,
		Settings:        config.SettingsOf(a.project),
		Now:             time.Now().Format(nowLayout),
		Today:           today(),
		Problems:        a.ledger.Problems(),
		Unsaved:         a.ledger.Unsaved(),
		HoldingProblems: a.holdings.Problems(),
		HoldingsUnsaved: a.holdings.Unsaved(),
	}, nil
}

// PresetRange resolves a named range such as this_month or all_time to dates.
func (a *App) PresetRange(name string) (Range, error) {
	from, to, err := report.PresetRange(name, today())
	return Range{From: from, To: to}, err
}

// Dashboard returns the summary cards and charts for transactions dated from..to (inclusive, either may be empty).
func (a *App) Dashboard(from, to string) (DashboardData, error) {
	if a.ledger == nil {
		return DashboardData{}, errNoProject
	}
	scope := report.Scope{From: from, To: to, Today: today()}
	if err := scope.Validate(); err != nil {
		return DashboardData{}, err
	}

	txns := a.ledger.Transactions()
	return DashboardData{
		Summary: report.Summarize(txns, a.project, scope),
		Charts:  report.RunAll(a.dashboard, txns, a.project, scope),
	}, nil
}

func (a *App) Ledger(query report.LedgerQuery) (report.LedgerData, error) {
	if a.ledger == nil {
		return report.LedgerData{}, errNoProject
	}
	return report.LedgerView(a.ledger.Transactions(), a.project, query), nil
}

func (a *App) Portfolio() (portfolio.View, error) {
	if a.ledger == nil {
		return portfolio.View{}, errNoProject
	}
	return portfolio.Build(a.holdings.Holdings(), a.project, a.ledger.Balance(), time.Now())
}

// CreateProject sets up the first project.
func (a *App) CreateProject(name, currency string, decimals int, categories []string) error {
	if a.startErr != nil {
		return a.startErr
	}
	if a.ledger != nil {
		return errors.New("a project is already open")
	}
	project := domain.Project{Name: name, Currency: currency, Decimals: decimals}
	for _, category := range categories {
		project.Categories = append(project.Categories, domain.Category{Name: strings.TrimSpace(category)})
	}
	slug, err := config.CreateProject(a.folders, project)
	if err != nil {
		return err
	}
	return a.loadProject(slug)
}

func (a *App) SaveSettings(settings config.Settings) error {
	if a.ledger == nil {
		return errNoProject
	}
	project, err := config.ApplySettings(a.project, settings)
	if err != nil {
		return err
	}
	return a.saveProject(project)
}

// SaveCategory adds a category or changes its colour. The name is what transactions refer to, so it stays fixed.
func (a *App) SaveCategory(name, color string) error {
	if a.ledger == nil {
		return errNoProject
	}
	return a.saveProject(a.project.WithCategory(strings.TrimSpace(name), color))
}

func (a *App) SetCategoryArchived(name string, archived bool) error {
	if a.ledger == nil {
		return errNoProject
	}
	project, found := a.project.WithArchived(name, archived)
	if !found {
		return fmt.Errorf("category %q not found", name)
	}
	return a.saveProject(project)
}

func (a *App) GetTransaction(id string) (storage.Fields, error) {
	if a.ledger == nil {
		return storage.Fields{}, errNoProject
	}
	return a.ledger.Get(id)
}

func (a *App) AddTransaction(f storage.Fields) error {
	if a.ledger == nil {
		return errNoProject
	}
	_, err := a.ledger.Add(f)
	return err
}

func (a *App) UpdateTransaction(f storage.Fields) error {
	if a.ledger == nil {
		return errNoProject
	}
	return a.ledger.Update(f)
}

func (a *App) DeleteTransaction(id string) error {
	if a.ledger == nil {
		return errNoProject
	}
	return a.ledger.Delete(id)
}

func (a *App) GetHolding(id string) (storage.HoldingFields, error) {
	if a.holdings == nil {
		return storage.HoldingFields{}, errNoProject
	}
	return a.holdings.Get(id)
}

func (a *App) AddHolding(f storage.HoldingFields) error {
	if a.holdings == nil {
		return errNoProject
	}
	return a.holdings.Add(f)
}

func (a *App) UpdateHolding(f storage.HoldingFields) error {
	if a.holdings == nil {
		return errNoProject
	}
	return a.holdings.Update(f)
}

func (a *App) DeleteHolding(id string) error {
	if a.holdings == nil {
		return errNoProject
	}
	return a.holdings.Delete(id)
}

// UpdatePrices fetches current prices. Holdings that fail keep their last price and are listed.
func (a *App) UpdatePrices() (PriceUpdate, error) {
	if a.holdings == nil {
		return PriceUpdate{}, errNoProject
	}
	ctx, cancel := context.WithTimeout(a.ctx, priceUpdateTimeout)
	defer cancel()

	quotes, failures := prices.Fetch(ctx, a.sources, a.holdings.Holdings(), time.Now())
	if len(quotes) > 0 {
		if err := a.holdings.ApplyQuotes(quotes); err != nil {
			return PriceUpdate{}, err
		}
	}
	return PriceUpdate{Updated: len(quotes), Failures: failures}, nil
}

// OpenProjectFolder shows the project's files in the system file manager.
func (a *App) OpenProjectFolder() error {
	if a.ledger == nil {
		return errNoProject
	}
	return application.Get().Env.OpenFileManager(filepath.Dir(a.projectPath), false)
}

// RetrySave writes changes that could not be saved earlier.
func (a *App) RetrySave() error {
	if a.ledger == nil {
		return errNoProject
	}
	if err := a.ledger.Save(); err != nil {
		return err
	}
	return a.holdings.Save()
}

// CheckForChanges reloads files that were edited outside the app and reports whether any were.
func (a *App) CheckForChanges() (bool, error) {
	if a.ledger == nil {
		return false, nil
	}
	changed := false
	for _, check := range []func() (bool, error){a.ledger.CheckExternalChange, a.holdings.CheckExternalChange, a.reloadProjectIfChanged} {
		reloaded, err := check()
		if err != nil {
			return changed, err
		}
		changed = changed || reloaded
	}
	return changed, nil
}

func (a *App) openProject() error {
	folders, err := config.DefaultFolders(runtime.GOOS)
	if err != nil {
		return err
	}
	a.folders = folders

	slug, found, err := config.ChooseProject(folders)
	if err != nil || !found {
		return err
	}
	return a.loadProject(slug)
}

func (a *App) loadProject(slug string) error {
	dir := a.folders.ProjectDir(slug)
	projectPath := a.folders.ProjectFile(slug)
	hash, err := storage.FileHash(projectPath)
	if err != nil {
		return err
	}
	project, err := config.LoadProject(projectPath)
	if err != nil {
		return err
	}
	dashboard, err := config.LoadDashboard(filepath.Join(dir, "dashboard.toml"))
	if err != nil {
		return err
	}
	ledger, err := storage.OpenLedger(filepath.Join(dir, "transactions.csv"), project.Decimals, time.Local)
	if err != nil {
		return err
	}
	holdings, err := storage.OpenHoldings(filepath.Join(dir, "holdings.csv"))
	if err != nil {
		return err
	}
	a.project, a.projectPath, a.projectHash = project, projectPath, hash
	a.dashboard, a.ledger, a.holdings = dashboard, ledger, holdings
	return nil
}

func (a *App) saveProject(project domain.Project) error {
	data, err := config.EncodeProject(project)
	if err != nil {
		return err
	}
	hash, err := storage.SaveFile(a.projectPath, data, a.projectHash, time.Now())
	if errors.Is(err, storage.ErrExternalChange) {
		if _, reloadErr := a.reloadProjectIfChanged(); reloadErr != nil {
			return reloadErr
		}
		return fmt.Errorf("%w; project.toml was reloaded and your change was not saved", err)
	}
	if err != nil {
		return err
	}
	a.project, a.projectHash = project, hash
	return nil
}

func (a *App) reloadProjectIfChanged() (bool, error) {
	hash, err := storage.FileHash(a.projectPath)
	if err != nil || hash == a.projectHash {
		return false, err
	}
	project, err := config.LoadProject(a.projectPath)
	if err != nil {
		return false, err
	}
	a.project, a.projectHash = project, hash
	return true, nil
}

func today() string {
	return time.Now().Format(domain.DateLayout)
}

package main

import (
	"context"
	"errors"
	"path/filepath"
	"runtime"
	"time"

	"el-costas/internal/config"
	"el-costas/internal/domain"
	"el-costas/internal/report"
	"el-costas/internal/storage"
)

const nowLayout = "2006-01-02 15:04"

var errNoProject = errors.New("no project is open")

// App is bound to the frontend; each method is a thin wrapper over the internal packages.
type App struct {
	folders   config.Folders
	project   domain.Project
	dashboard []domain.ChartDef
	ledger    *storage.Ledger
	startErr  error
}

// State is everything the frontend draws, for one date range.
type State struct {
	NeedsSetup  bool              `json:"needsSetup"`
	ProjectName string            `json:"projectName"`
	Currency    string            `json:"currency"`
	Categories  []string          `json:"categories"`
	Now         string            `json:"now"`
	Rows        []storage.Fields  `json:"rows"`
	Charts      []report.Chart    `json:"charts"`
	Problems    []storage.Problem `json:"problems"`
	Unsaved     bool              `json:"unsaved"`
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(_ context.Context) {
	a.startErr = a.openProject()
}

// State returns the project's rows and charts for transactions dated from..to (inclusive, either may be empty).
func (a *App) State(from, to string) (State, error) {
	if a.startErr != nil {
		return State{}, a.startErr
	}
	if a.ledger == nil {
		return State{NeedsSetup: true}, nil
	}

	txns, err := report.FilterRange(a.ledger.Transactions(), from, to)
	if err != nil {
		return State{}, err
	}
	charts := make([]report.Chart, len(a.dashboard))
	for i, def := range a.dashboard {
		charts[i] = report.Run(def, txns, a.project)
	}
	return State{
		ProjectName: a.project.Name,
		Currency:    a.project.Currency,
		Categories:  a.project.Categories,
		Now:         time.Now().Format(nowLayout),
		Rows:        storage.Rows(txns, a.project.Decimals),
		Charts:      charts,
		Problems:    a.ledger.Problems(),
		Unsaved:     a.ledger.Unsaved(),
	}, nil
}

// CreateProject sets up the first project.
func (a *App) CreateProject(name, currency string, decimals int, categories []string) error {
	if a.startErr != nil {
		return a.startErr
	}
	if a.ledger != nil {
		return errors.New("a project is already open")
	}
	slug, err := config.CreateProject(a.folders, domain.Project{
		Name: name, Currency: currency, Decimals: decimals, Categories: categories,
	})
	if err != nil {
		return err
	}
	return a.loadProject(slug)
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

// RetrySave writes changes that could not be saved earlier.
func (a *App) RetrySave() error {
	if a.ledger == nil {
		return errNoProject
	}
	return a.ledger.Save()
}

// CheckForChanges reloads the file if it was edited outside the app and reports whether it did.
func (a *App) CheckForChanges() (bool, error) {
	if a.ledger == nil {
		return false, nil
	}
	return a.ledger.CheckExternalChange()
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
	project, err := config.LoadProject(a.folders.ProjectFile(slug))
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
	a.project, a.dashboard, a.ledger = project, dashboard, ledger
	return nil
}

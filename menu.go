package main

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const eventNewTransaction = "new-transaction"

func buildMenu(wails *application.App, app *App) *application.Menu {
	appMenu := application.NewMenu()
	if runtime.GOOS == "darwin" {
		appMenu.AddRole(application.AppMenu)
	}

	file := appMenu.AddSubmenu("File")
	file.Add("New Transaction").SetAccelerator("CmdOrCtrl+n").OnClick(func(*application.Context) {
		wails.Event.Emit(eventNewTransaction)
	})
	file.Add("Show Project Folder").OnClick(func(*application.Context) {
		_ = app.OpenProjectFolder()
	})

	if runtime.GOOS == "darwin" {
		appMenu.AddRole(application.EditMenu)
		appMenu.AddRole(application.WindowMenu)
	}
	return appMenu
}

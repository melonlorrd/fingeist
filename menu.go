package main

import (
	"runtime"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const eventNewTransaction = "new-transaction"

func buildMenu(app *App) *menu.Menu {
	appMenu := menu.NewMenu()
	if runtime.GOOS == "darwin" {
		appMenu.Append(menu.AppMenu())
	}

	file := appMenu.AddSubmenu("File")
	file.AddText("New Transaction", keys.CmdOrCtrl("n"), func(*menu.CallbackData) {
		wailsruntime.EventsEmit(app.ctx, eventNewTransaction)
	})
	file.AddText("Show Project Folder", nil, func(*menu.CallbackData) {
		_ = app.OpenProjectFolder()
	})

	if runtime.GOOS == "darwin" {
		appMenu.Append(menu.EditMenu())
		appMenu.Append(menu.WindowMenu())
	}
	return appMenu
}

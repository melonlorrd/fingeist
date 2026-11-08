package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	wails := application.New(application.Options{
		Name:     "El Costas",
		Services: []application.Service{application.NewService(app)},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})
	wails.Menu.Set(buildMenu(wails, app))
	wails.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "El Costas",
		Width:            1200,
		Height:           800,
		MinWidth:         640,
		MinHeight:        440,
		BackgroundColour: application.NewRGB(27, 38, 54),
		URL:              "/",
	})

	if err := wails.Run(); err != nil {
		log.Fatal(err)
	}
}

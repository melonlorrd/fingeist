package config

import (
	"errors"
	"os"
	"path/filepath"
)

const appDirName = "fingeist"

// Folders are where Fingeist keeps settings (Config) and projects (Data).
type Folders struct {
	Config string
	Data   string
}

// ProjectDir is the folder of one project.
func (f Folders) ProjectDir(slug string) string {
	return filepath.Join(f.Data, "projects", slug)
}

// AppFile is the path of app.toml.
func (f Folders) AppFile() string {
	return filepath.Join(f.Config, "app.toml")
}

// ResolveFolders applies FINGEIST_HOME, then each OS's convention.
// userConfigDir is os.UserConfigDir's result, used on macOS and Windows.
func ResolveFolders(goos string, getenv func(string) string, homeDir, userConfigDir string) (Folders, error) {
	if home := getenv("FINGEIST_HOME"); home != "" {
		return Folders{Config: home, Data: home}, nil
	}

	switch goos {
	case "darwin", "windows":
		if userConfigDir == "" {
			return Folders{}, errors.New("cannot find the user config directory")
		}
		dir := filepath.Join(userConfigDir, appDirName)
		return Folders{Config: dir, Data: dir}, nil
	default:
		config, err := xdgDir(getenv("XDG_CONFIG_HOME"), homeDir, ".config")
		if err != nil {
			return Folders{}, err
		}
		data, err := xdgDir(getenv("XDG_DATA_HOME"), homeDir, filepath.Join(".local", "share"))
		if err != nil {
			return Folders{}, err
		}
		return Folders{Config: filepath.Join(config, appDirName), Data: filepath.Join(data, appDirName)}, nil
	}
}

// DefaultFolders resolves the folders for the running OS and environment.
func DefaultFolders(goos string) (Folders, error) {
	homeDir, _ := os.UserHomeDir()
	userConfigDir, _ := os.UserConfigDir()
	return ResolveFolders(goos, os.Getenv, homeDir, userConfigDir)
}

func xdgDir(envValue, homeDir, homeRelative string) (string, error) {
	if filepath.IsAbs(envValue) {
		return envValue, nil
	}
	if homeDir == "" {
		return "", errors.New("cannot find the home directory")
	}
	return filepath.Join(homeDir, homeRelative), nil
}

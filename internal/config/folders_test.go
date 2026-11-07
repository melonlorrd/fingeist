package config

import (
	"path/filepath"
	"testing"
)

func TestResolveFolders(t *testing.T) {
	tests := []struct {
		name          string
		goos          string
		env           map[string]string
		home          string
		userConfigDir string
		want          Folders
		wantErr       bool
	}{
		{
			name: "override wins on linux",
			goos: "linux", env: map[string]string{"EL_COSTAS_HOME": "/dev/home", "XDG_CONFIG_HOME": "/x"},
			home: "/home/u",
			want: Folders{Config: "/dev/home", Data: "/dev/home"},
		},
		{
			name: "override wins on darwin",
			goos: "darwin", env: map[string]string{"EL_COSTAS_HOME": "/dev/home"},
			userConfigDir: "/Users/u/Library/Application Support",
			want:          Folders{Config: "/dev/home", Data: "/dev/home"},
		},
		{
			name: "override wins on windows",
			goos: "windows", env: map[string]string{"EL_COSTAS_HOME": `C:\dev`},
			want: Folders{Config: `C:\dev`, Data: `C:\dev`},
		},
		{
			name: "linux defaults",
			goos: "linux", home: "/home/u",
			want: Folders{
				Config: filepath.Join("/home/u", ".config", "el-costas"),
				Data:   filepath.Join("/home/u", ".local", "share", "el-costas"),
			},
		},
		{
			name: "linux with both XDG vars",
			goos: "linux", env: map[string]string{"XDG_CONFIG_HOME": "/cfg", "XDG_DATA_HOME": "/dat"},
			home: "/home/u",
			want: Folders{Config: filepath.Join("/cfg", "el-costas"), Data: filepath.Join("/dat", "el-costas")},
		},
		{
			name: "linux with only XDG config",
			goos: "linux", env: map[string]string{"XDG_CONFIG_HOME": "/cfg"},
			home: "/home/u",
			want: Folders{
				Config: filepath.Join("/cfg", "el-costas"),
				Data:   filepath.Join("/home/u", ".local", "share", "el-costas"),
			},
		},
		{
			name: "linux ignores relative XDG vars",
			goos: "linux", env: map[string]string{"XDG_CONFIG_HOME": "cfg", "XDG_DATA_HOME": "dat"},
			home: "/home/u",
			want: Folders{
				Config: filepath.Join("/home/u", ".config", "el-costas"),
				Data:   filepath.Join("/home/u", ".local", "share", "el-costas"),
			},
		},
		{
			name: "linux with XDG vars needs no home",
			goos: "linux", env: map[string]string{"XDG_CONFIG_HOME": "/cfg", "XDG_DATA_HOME": "/dat"},
			want: Folders{Config: filepath.Join("/cfg", "el-costas"), Data: filepath.Join("/dat", "el-costas")},
		},
		{name: "linux without home or XDG", goos: "linux", wantErr: true},
		{
			name: "darwin ignores XDG",
			goos: "darwin", env: map[string]string{"XDG_CONFIG_HOME": "/cfg", "XDG_DATA_HOME": "/dat"},
			home: "/Users/u", userConfigDir: "/Users/u/Library/Application Support",
			want: Folders{
				Config: filepath.Join("/Users/u/Library/Application Support", "el-costas"),
				Data:   filepath.Join("/Users/u/Library/Application Support", "el-costas"),
			},
		},
		{
			name: "windows uses APPDATA",
			goos: "windows", userConfigDir: `C:\Users\u\AppData\Roaming`,
			want: Folders{
				Config: filepath.Join(`C:\Users\u\AppData\Roaming`, "el-costas"),
				Data:   filepath.Join(`C:\Users\u\AppData\Roaming`, "el-costas"),
			},
		},
		{name: "darwin without config dir", goos: "darwin", home: "/Users/u", wantErr: true},
		{name: "windows without config dir", goos: "windows", wantErr: true},
		{
			name: "other unix uses XDG",
			goos: "freebsd", home: "/home/u",
			want: Folders{
				Config: filepath.Join("/home/u", ".config", "el-costas"),
				Data:   filepath.Join("/home/u", ".local", "share", "el-costas"),
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ResolveFolders(tt.goos, func(k string) string { return tt.env[k] }, tt.home, tt.userConfigDir)
			if (err != nil) != tt.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, tt.wantErr)
			}
			if got != tt.want {
				t.Fatalf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestFoldersPaths(t *testing.T) {
	f := Folders{Config: "/cfg", Data: "/dat"}
	if got, want := f.ProjectDir("home"), filepath.Join("/dat", "projects", "home"); got != want {
		t.Fatalf("ProjectDir = %q, want %q", got, want)
	}
	if got, want := f.AppFile(), filepath.Join("/cfg", "app.toml"); got != want {
		t.Fatalf("AppFile = %q, want %q", got, want)
	}
}

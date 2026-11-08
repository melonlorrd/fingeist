{
  description = "Fingeist: personal local expense manager (Go + Wails)";

  inputs = {
    # Release branch: fewer surprise breakages than unstable. Bump deliberately.
    # The -darwin branch also serves Linux; it just advances once macOS builds pass.
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-26.05-darwin";
  };

  outputs = { nixpkgs, ... }:
    let
      # Windows has no Nix; Windows builds are cross-compiled from these (see README).
      systems = [ "aarch64-darwin" "x86_64-darwin" "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f:
        nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # nixpkgs only carries an old v3 beta, so build the v3.1.0 CLI from source.
      wails3 = pkgs: pkgs.buildGoModule rec {
        pname = "wails3";
        version = "3.1.0";
        src = pkgs.fetchFromGitHub {
          owner = "wailsapp";
          repo = "wails";
          rev = "v${version}";
          hash = "sha256-Eqi2QEOdgjeJXYRtFJSYgqovDXn8PFoF5QExwhFg/+8=";
        };
        modRoot = "v3";
        subPackages = [ "cmd/wails3" ];
        vendorHash = "sha256-VmWjstXfAcbNf/3XpP6pUPbq5K3EApSCANFVzKsruVE=";
        doCheck = false;
      };
    in
    {
      devShells = forAllSystems (pkgs:
        let
          appTools = (with pkgs; [ go nodejs ]) ++ [ (wails3 pkgs) ];
        in
        {
          default = pkgs.mkShell {
            packages = appTools ++ (with pkgs; [
              gopls
              gotools          # goimports etc.
              golangci-lint
              delve            # debugger
            ]) ++ pkgs.lib.optionals pkgs.stdenv.isLinux (with pkgs; [
              # Wails on Linux renders with WebKitGTK 6 (GTK 4)
              pkg-config
              gtk4
              webkitgtk_6_0
              libsoup_3
            ]);

            # Wails uses cgo on macOS and Linux. Windows builds need CGO_ENABLED=0 (see README).
            CGO_ENABLED = "1";

            shellHook = ''
              repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

              # Dev sessions never touch real data: point the app at a scratch copy
              # of the sample data. data/dev/ is gitignored and safe to delete.
              export FINGEIST_HOME="$repo_root/data/dev"
              if [ ! -d "$FINGEIST_HOME" ] && [ -d "$repo_root/data/sample" ]; then
                cp -R "$repo_root/data/sample" "$FINGEIST_HOME"
              fi

              wails_version="$(wails3 version 2>&1 | tail -n1)"
              case "$wails_version" in
                v3.*) ;;
                *) echo "WARNING: expected Wails v3.x, got '$wails_version'" ;;
              esac

              echo "Fingeist dev shell"
              echo "  go:    $(go version | cut -d' ' -f3)"
              echo "  node:  $(node --version)"
              echo "  wails3: $wails_version"
              echo "  home:  $FINGEIST_HOME"
            '';
          };
        });
    };
}

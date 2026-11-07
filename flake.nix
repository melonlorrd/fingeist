{
  description = "El Costas: personal local expense manager (Go + Wails)";

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
    in
    {
      devShells = forAllSystems (pkgs:
        let
          appTools = with pkgs; [ go nodejs wails ];
        in
        {
          default = pkgs.mkShell {
            packages = appTools ++ (with pkgs; [
              gopls
              gotools          # goimports etc.
              golangci-lint
              delve            # debugger
            ]) ++ pkgs.lib.optionals pkgs.stdenv.isLinux (with pkgs; [
              # Wails on Linux renders with WebKitGTK; build with -tags webkit2_41
              pkg-config
              gtk3
              webkitgtk_4_1
              libsoup_3
            ]);

            # Wails uses cgo on macOS and Linux
            CGO_ENABLED = "1";

            shellHook = ''
              repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

              # Dev sessions never touch real data: point the app at a scratch copy
              # of the sample data. data/dev/ is gitignored and safe to delete.
              export EL_COSTAS_HOME="$repo_root/data/dev"
              if [ ! -d "$EL_COSTAS_HOME" ] && [ -d "$repo_root/data/sample" ]; then
                cp -R "$repo_root/data/sample" "$EL_COSTAS_HOME"
              fi

              wails_version="$(wails version 2>/dev/null | head -n1)"
              case "$wails_version" in
                v2.*) ;;
                *) echo "WARNING: expected Wails v2.x, got '$wails_version'" ;;
              esac

              echo "El Costas dev shell"
              echo "  go:    $(go version | cut -d' ' -f3)"
              echo "  node:  $(node --version)"
              echo "  wails: $wails_version"
              echo "  home:  $EL_COSTAS_HOME"
            '';
          };
        });
    };
}

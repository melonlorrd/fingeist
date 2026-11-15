{
  description = "Fingeist: offline-first expense ledger (PWA)";

  inputs = {
    # Release branch: fewer surprise breakages than unstable. Bump deliberately.
    # The -darwin branch also serves Linux; it just advances once macOS builds pass.
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-26.05-darwin";
  };

  outputs = { nixpkgs, ... }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f:
        nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # Each helper runs from the repo root and installs npm dependencies first when they are missing
      # or older than package-lock.json.
      helper = pkgs: name: description: script: pkgs.writeShellApplication {
        inherit name;
        runtimeInputs = [ pkgs.nodejs pkgs.git pkgs.biome ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
            npm ci --no-audit --no-fund
          fi
          ${script}
        '';
        meta.description = description;
      };

      helpers = pkgs: [
        (helper pkgs "dev" "Live-reloading dev server on http://127.0.0.1:5173" ''npm run --silent dev -- "$@"'')
        (helper pkgs "check" "Lint, format check, type check and all tests" ''
          biome check
          npx tsc -p .
          npm test
        '')
        (helper pkgs "fmt" "Format and apply safe lint fixes" ''biome check --write'')
        (helper pkgs "build" "Production build into dist/" ''npm run --silent build'')
        (helper pkgs "preview" "Build, then serve dist/ with the service worker (for offline testing)" ''
          npm run --silent build
          npm run --silent preview -- "$@"
        '')
      ];
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs pkgs.biome ] ++ helpers pkgs;
          shellHook = ''
            echo "Fingeist dev shell (node $(node --version))"
            echo "  dev      live-reloading dev server"
            echo "  check    lint, format check, type check and all tests"
            echo "  fmt      format and apply safe lint fixes"
            echo "  build    production build into dist/"
            echo "  preview  build and serve dist/, to try offline mode"
          '';
        };
      });
    };
}

{
  inputs = {
    flake-utils.url = "github:numtide/flake-utils";
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = inputs:
    inputs.flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = (import (inputs.nixpkgs) { inherit system; });
        pkgJson = builtins.fromJSON (builtins.readFile ./package.json);
        vsix = pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
          name = "icantbelievegit-${finalAttrs.version}.vsix";
          pname = "icantbelievegit-vsix";
          version = pkgJson.version;
          src = ./.;
          npmDeps = pkgs.fetchNpmDeps {
            name = "${finalAttrs.pname}-npm-deps";
            inherit (finalAttrs) src;
            hash = "sha256-Egx2+H0rqGuP4MjDx7V+C+632/sXFOE2lJPPiFJBZiw=";
          };
          nativeBuildInputs = [
            pkgs.nodejs_24
            pkgs.npmHooks.npmConfigHook
            pkgs.vsce
          ];
          buildPhase = ''
            runHook preBuild
            vsce package
            runHook postBuild
          '';
          installPhase = ''
            runHook preInstall
            cp ./icantbelievegit-$version.vsix $out
            runHook postInstall
          '';
        });
        extension = pkgs.vscode-utils.buildVscodeExtension (finalAttrs: {
          pname = "vscode-icantbelievegit";
          inherit (finalAttrs.src) version;
          vscodeExtPublisher = "ErnWong";
          vscodeExtName = "icantbelievegit";
          vscodeExtUniqueId = "${finalAttrs.vscodeExtPublisher}.${finalAttrs.vscodeExtName}";
          src = vsix;
          unpackPhase = ''
            runHook preUnpack
            unzip $src
            runHook postUnpack
          '';
        });
      in {
        devShell = pkgs.mkShell {
          buildInputs=[
            pkgs.nodejs_24
            pkgs.nodePackages.typescript
            pkgs.nodePackages.typescript-language-server
            pkgs.vsce
          ];
        };
        packages = {
          inherit vsix extension;
          default = extension;
        };
      }
    );
}
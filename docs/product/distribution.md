# DAX Distribution Channels

This guide covers end-user install paths and maintainer publishing workflows for the DAX execution control plane.

## End-user install

### macOS/Linux (script)

```bash
curl -fsSL https://raw.githubusercontent.com/ShaileshRawat1403/dax-tui/main/script/install.sh | DAX_VERSION=<release-tag> bash
```

Notes:
- For prereleases, pass `DAX_VERSION=vX.Y.Z-beta.N`.
- Without `DAX_VERSION`, installer resolves latest stable first and falls back to latest non-draft release.

### macOS/Linux (Homebrew)

```bash
brew install ShaileshRawat1403/tap/dax
```

Notes:
- Homebrew installs from the public `ShaileshRawat1403/homebrew-tap` tap.
- The formula is generated from release assets and checksums.

### Windows (WinGet)

```powershell
winget install DaxAi.DAX
```

### Windows (manual fallback)

1. Download `dax-windows-x64.zip` from GitHub Releases.
2. Extract `dax.exe` into a folder (example `C:\Tools\dax`).
3. Add that folder to system/user `PATH`.
4. Run `dax --version` in a new terminal.

## Maintainer workflows

Two GitHub Actions workflows are included:

1. `.github/workflows/publish-homebrew.yml`
2. `.github/workflows/publish-winget.yml`

Both are `workflow_dispatch` workflows and require `version` input (example: `vX.Y.Z`).

### Homebrew

What it does:
- Generates `dist/homebrew/Formula/dax.rb` from release `manifest.json`.
- Uploads formula as workflow artifact.
- Optionally pushes to a Homebrew tap repo.

Required secrets for tap publish:
- `HOMEBREW_TAP_TOKEN`: PAT with repo write access to tap repo.
- `HOMEBREW_TAP_REPO`: repo path, e.g. `ShaileshRawat1403/homebrew-tap`.

### Winget

What it does:
- Generates manifest files in `dist/winget/manifests/<version>/`.
- Uploads manifests as workflow artifact.
- Optional submit job runs `wingetcreate update` when onboarding already exists.

Required secret for submit:
- `WINGETCREATE_TOKEN`: GitHub token used by wingetcreate submission flow.

Important:
- If package onboarding is not merged yet in `microsoft/winget-pkgs`, workflow will skip submit and print a clear notice.
- After onboarding merge, rerun with `submit=true` to publish updates automatically.

## Local generation commands

```bash
# Homebrew formula
bun run dist:homebrew --version <release-tag> --repo ShaileshRawat1403/dax-tui

# Winget manifests
bun run dist:winget --version <release-tag> --repo ShaileshRawat1403/dax-tui --id DaxAi.DAX
```

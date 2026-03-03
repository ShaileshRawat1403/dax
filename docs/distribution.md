# DAX Distribution Channels

This guide covers end-user install paths and maintainer publishing workflows.

## End-user install

### macOS/Linux (script)

```bash
curl -fsSL https://raw.githubusercontent.com/ShaileshRawat1403/dax-tui/main/script/install.sh | DAX_VERSION=v1.0.0-beta.6 bash
```

Notes:
- For prereleases, pass `DAX_VERSION=vX.Y.Z-beta.N`.
- Without `DAX_VERSION`, installer resolves latest stable first and falls back to latest non-draft release.

### Windows (manual)

1. Download `dax-windows-x64.zip` from GitHub Releases.
2. Extract `dax.exe` into a folder (example `C:\Tools\dax`).
3. Add that folder to system/user `PATH`.
4. Run `dax --version` in a new terminal.

## Maintainer workflows

Two GitHub Actions workflows are included:

1. `.github/workflows/publish-homebrew.yml`
2. `.github/workflows/publish-winget.yml`

Both are `workflow_dispatch` workflows and require `version` input (example: `v1.0.0-beta.6`).

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
- Optional submit job runs `wingetcreate update`.

Required secret for submit:
- `WINGETCREATE_TOKEN`: GitHub token used by wingetcreate submission flow.

Important:
- `publish-winget.yml` submit path assumes package identifier already exists in winget-pkgs.
- For first-time package onboarding, run a manual initial submit and then use update flow.

## Local generation commands

```bash
# Homebrew formula
bun run dist:homebrew --version v1.0.0-beta.6 --repo ShaileshRawat1403/dax-tui

# Winget manifests
bun run dist:winget --version v1.0.0-beta.6 --repo ShaileshRawat1403/dax-tui --id ShaileshRawat1403.DAX
```

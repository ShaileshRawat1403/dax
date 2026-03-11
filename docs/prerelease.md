# DAX Peer Pre-release Guide

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/dax-ai/dax/main/script/install.sh | DAX_VERSION=vX.Y.Z-beta.N bash
```

If you always want latest published release tag (stable first, then prerelease fallback):

```bash
curl -fsSL https://raw.githubusercontent.com/dax-ai/dax/main/script/install.sh | bash
```

Optional installer variables:

- `DAX_VERSION`: release tag to install (example: `v1.0.0-beta.1`)
- `DAX_INSTALL_DIR`: install directory (default: `~/.local/bin`)
- `DAX_REPO`: release repo (default: `dax-ai/dax`)

## Uninstall

```bash
rm -f ~/.local/bin/dax
```

## Update

```bash
curl -fsSL https://raw.githubusercontent.com/dax-ai/dax/main/script/install.sh | DAX_VERSION=vX.Y.Z-beta.N bash
```

## Minimum System Requirements

- macOS (arm64 or x64), Linux (arm64 or x64), Windows x64 (manual binary download)
- Terminal with 256-color support
- Internet access for provider APIs

## Windows Install (Manual)

1. Download `dax-windows-x64.zip` from the release assets.
2. Extract `dax.exe` to a directory (example: `C:\Tools\dax`).
3. Add that directory to `PATH`.
4. Open a new terminal and run:

```powershell
dax --version
```

## Provider Quickstart

1. Start DAX:

   ```bash
   dax
   ```

2. Configure a provider key/token:
   - OpenAI: `OPENAI_API_KEY`
   - Anthropic: `ANTHROPIC_API_KEY`
   - Google/Gemini: `dax auth login` (Google OAuth) or `GEMINI_API_KEY`
   - Ollama: local daemon running (default `http://localhost:11434`)

3. Validate by running a prompt and confirming streaming output + tool approvals.

## Release Validation Matrix

Run this before publishing a beta:

```bash
bun run release:verify
bun run build
```

Google auth checks:

```bash
# If your globally installed dax is older, run local source command:
bun run --cwd packages/dax src/index.ts auth doctor google/gemini-2.5-flash
bun run --cwd packages/dax src/index.ts auth login
```

Expected:
- `auth doctor` shows `google: OK (...)`.
- OAuth client id matches intended client.
- A `google/*` prompt succeeds after login.
- A `google-vertex/*` prompt requires `GOOGLE_CLOUD_PROJECT` + ADC.

## Known Limitations (Peer Pre-release)

- GitHub `releases/latest/download/...` can return 404 when only prereleases exist.
- Non-core providers and advanced toolchains may need extra setup.
- Pre-release versions can change state/config format between builds.
- If global `dax` in `PATH` is on an older beta, new commands (like `auth doctor`) may not exist until you install the latest release binary.

## Report Issues

Open an issue at <https://github.com/dax-ai/dax/issues> with:

- DAX version tag (`dax --version`)
- OS + architecture
- Provider in use
- Repro steps
- Expected vs actual behavior
- Screenshot or terminal log (if available)


## Build and Publish (Maintainers)

```bash
bun run release:verify
bun run release
DAX_VERSION=1.0.0-beta.1 bun run release:publish
```

To publish immediately (not draft):

```bash
DAX_VERSION=1.0.0-beta.1 bun run release:publish:live
```

# DAX Peer Pre-release Guide

## Install

```bash
curl -fsSL https://github.com/ShaileshRawat1403/dax-tui/releases/latest/download/install.sh | DAX_VERSION=vX.Y.Z-beta.N bash
```

If you always want latest release from GitHub:

```bash
curl -fsSL https://github.com/ShaileshRawat1403/dax-tui/releases/latest/download/install.sh | bash
```

Optional installer variables:

- `DAX_VERSION`: release tag to install (example: `v1.0.0-beta.1`)
- `DAX_INSTALL_DIR`: install directory (default: `~/.local/bin`)
- `DAX_REPO`: release repo (default: `ShaileshRawat1403/dax`)

## Uninstall

```bash
rm -f ~/.local/bin/dax
```

## Update

```bash
curl -fsSL https://github.com/ShaileshRawat1403/dax-tui/releases/latest/download/install.sh | DAX_VERSION=vX.Y.Z-beta.N bash
```

## Minimum System Requirements

- macOS (arm64 or x64), Linux (arm64 or x64), Windows x64 (manual binary download)
- Terminal with 256-color support
- Internet access for provider APIs

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

## Beta.6 Validation Matrix

Run this before publishing beta.6:

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

- Windows installer script is not included yet (download archive manually from release assets).
- Non-core providers and advanced toolchains may need extra setup.
- Pre-release versions can change state/config format between builds.
- If global `dax` in `PATH` is on an older beta, new commands (like `auth doctor`) may not exist until you install the latest release binary.

## Report Issues

Open an issue at <https://github.com/ShaileshRawat1403/dax-tui/issues> with:

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

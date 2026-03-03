# DAX 1.0.0-beta.6 Release Notes

## Scope

- Google Gemini/Vertex auth hardening and diagnostics
- TUI prompt focus/unmount stability improvements
- Auth and prerelease documentation updates

## Included Changes

- Added provider auth preflight for:
  - `google/*` (Gemini API auth path)
  - `google-vertex/*` and `google-vertex-anthropic/*` (ADC/project path)
- Added `dax auth doctor [model]` diagnostics command.
- Added Google OAuth callback error clarity and browser auto-open on login.
- Added `.env` hierarchy loading during bootstrap.
- Strengthened prompt lifecycle/focus recovery in TUI.
- Updated provider snapshot via build (`packages/dax/src/provider/models-snapshot.ts`).

## Verification Results

Runbook:

```bash
bun run release:verify
bun run build
bun run --cwd packages/dax src/index.ts auth --help
bun run --cwd packages/dax src/index.ts auth doctor google/gemini-2.5-flash
```

Expected:

- `release:verify` passes
- `build` passes
- `auth doctor` appears in help
- `auth doctor` reports effective Google client id and auth mode

## Release Checklist

1. Ensure release PR includes regenerated `packages/dax/src/provider/models-snapshot.ts`.
2. Confirm docs shipped:
   - `README.md` auth matrix/troubleshooting
   - `docs/prerelease.md` beta.6 validation matrix
   - `docs/PROVIDERS.md` provider split guidance
3. Publish prerelease:
   - `DAX_VERSION=1.0.0-beta.6 bun run release:publish`
4. Optional live publish:
   - `DAX_VERSION=1.0.0-beta.6 bun run release:publish:live`

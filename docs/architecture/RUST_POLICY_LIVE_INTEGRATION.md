# Rust Policy Live Integration

## Status

Implemented as Phase 1 behind `DAX_RUST_POLICY=1`.

## Purpose

DAX has two policy surfaces:

- TypeScript `Permission.ask`, which is the live approval enforcement point.
- Rust `dax-policy`, which owns deterministic path-zone classification and proof-ladder policy behavior.

The live integration keeps TypeScript in charge of user rules, pending approvals, persistence, and operator UX. Rust supplies a safety floor for path sensitivity.

## Boundary

TypeScript still evaluates the configured ruleset first. When `DAX_RUST_POLICY=1` is set, `Permission.ask` also calls:

```text
dax-policy classify
```

Input:

```json
{ "paths": ["/project/.env.production"] }
```

Output:

```json
{
  "results": [
    {
      "path": "/project/.env.production",
      "zone": "sensitive",
      "reason": "matches environment pattern: .env"
    }
  ]
}
```

## Decision Rules

Rust classification is a floor, not a replacement:

| Rust zone | Effect on live TS decision |
| --- | --- |
| `forbidden` | force `deny` |
| `sensitive` | upgrade `allow` to `ask` |
| `lab` | no override in Phase 1 |
| `artifact_or_temp` | no override in Phase 1 |
| `repo_safe` | no override |

Existing TypeScript `deny` rules still win. Existing TypeScript `ask` rules still ask.

## Alignment Correction

The draft design assumed the `.env.example` carve-out could remain only in TypeScript. That does not work with a Rust safety floor: if Rust marks `.env.example` as `sensitive`, TypeScript cannot safely downgrade it back to `allow`.

Therefore Rust now treats an exact `.env.example` basename as `repo_safe`, unless another sensitive marker in the path still matches, such as `secrets/.env.example`.

## Rollout

Phase 1 is intentionally narrow:

- Add `dax-policy classify`.
- Add `classifyPathsWithRust` to the TS adapter.
- Gate live use behind `DAX_RUST_POLICY=1`.
- Record Rust classification metadata in the RAO audit payload.
- Surface sensitive-path reasons in approval metadata.

Future phases can simplify duplicated TypeScript sensitive-path defaults only after the flag-on path has been exercised in CI and local use.

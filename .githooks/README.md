# Repo-tracked git hooks

These hooks are committed so every contributor can opt into the same enforcement. They are not enabled by default — git only reads from `.git/hooks/` unless you point it elsewhere.

## Enable once per clone

```sh
git config core.hooksPath .githooks
```

That's it. Git will now run `.githooks/<hook>` instead of `.git/hooks/<hook>`.

## What's enforced

| Hook | What it does |
|---|---|
| `pre-commit` | Refuses commits on `main` / `master`. Bypass with `DAX_ALLOW_MAIN_COMMIT=1 git commit ...` — use only for already-reviewed release merges. |

## Why opt-in instead of automatic

Git does not allow a repo to silently enable its own hooks (security feature — untrusted clones can't run code via `git pull`). Documenting the one-line opt-in is the standard pattern.

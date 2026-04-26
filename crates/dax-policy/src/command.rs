use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionClass {
    Analyze,
    Propose,
    Mutate,
    Commit,
    Publish,
    Verify,
}

const VERIFY_COMMANDS: &[&str] = &[
    "cargo test",
    "cargo check",
    "cargo clippy",
    "cargo fmt --check",
    "bun test",
    "bun run test",
    "bun run typecheck",
    "bun run check",
    "git status",
    "git log",
    "git diff",
    "git show",
    "ls",
    "cat",
    "head",
    "tail",
    "find",
    "grep",
    "rg",
    "echo",
    "pwd",
    "which",
    "command -v",
];

const PUBLISH_COMMANDS: &[&str] = &[
    "git push",
    "npm publish",
    "bun publish",
    "cargo publish",
    "gh release",
    "docker push",
    "kubectl apply",
];

const COMMIT_COMMANDS: &[&str] = &[
    "git commit",
    "git tag",
    "git merge",
    "git rebase",
    "git reset",
];

const MUTATING_PREFIXES: &[&str] = &[
    "rm ",
    "rm\t",
    "mv ",
    "cp ",
    "mkdir ",
    "touch ",
    "chmod ",
    "chown ",
    "cargo build",
    "cargo install",
    "bun install",
    "npm install",
    "pip install",
    "curl ",
    "wget ",
    "git add",
    "git stash",
    "git checkout",
    "git switch",
    "git restore",
];

pub fn classify_command(cmd: &str) -> ActionClass {
    let trimmed = cmd.trim();
    let lower = trimmed.to_lowercase();

    for v in PUBLISH_COMMANDS {
        if lower.starts_with(v) || lower.contains(v) {
            return ActionClass::Publish;
        }
    }

    for c in COMMIT_COMMANDS {
        if lower.starts_with(c) {
            return ActionClass::Commit;
        }
    }

    for m in MUTATING_PREFIXES {
        if lower.starts_with(m) {
            return ActionClass::Mutate;
        }
    }

    for v in VERIFY_COMMANDS {
        if lower.starts_with(v) {
            return ActionClass::Verify;
        }
    }

    if lower.contains("write")
        || lower.contains("edit")
        || lower.contains("create")
        || lower.contains("update")
    {
        return ActionClass::Propose;
    }

    ActionClass::Analyze
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_push_is_publish() {
        assert_eq!(
            classify_command("git push origin main"),
            ActionClass::Publish
        );
    }

    #[test]
    fn git_commit_is_commit() {
        assert_eq!(classify_command("git commit -m 'fix'"), ActionClass::Commit);
    }

    #[test]
    fn rm_is_mutate() {
        assert_eq!(classify_command("rm -rf /tmp/foo"), ActionClass::Mutate);
    }

    #[test]
    fn cargo_test_is_verify() {
        assert_eq!(
            classify_command("cargo test --workspace"),
            ActionClass::Verify
        );
    }

    #[test]
    fn git_status_is_verify() {
        assert_eq!(classify_command("git status"), ActionClass::Verify);
    }

    #[test]
    fn ls_is_verify() {
        assert_eq!(classify_command("ls -la"), ActionClass::Verify);
    }
}

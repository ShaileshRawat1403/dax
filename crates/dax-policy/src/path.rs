use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PathZone {
    Forbidden,
    Sensitive,
    Lab,
    ArtifactOrTemp,
    RepoSafe,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PathClassification {
    pub path: String,
    pub zone: PathZone,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

const FORBIDDEN_PATTERNS: &[&str] = &[
    "/etc/passwd",
    "/etc/shadow",
    "/etc/sudoers",
    "/private/etc/",
    "/.ssh/",
    "/.gnupg/",
    "/proc/",
    "/sys/",
    "/dev/",
];

const SENSITIVE_PATTERNS: &[&str] = &[
    // DAX's own credential stores were absent from this list, so the gate that
    // protects everyone else's secrets did not protect the operator's provider
    // keys.
    "/dax/auth.json",
    "/dax/mcp-auth.json",
    "/.aws/",
    "/.netrc",
    "/.kube/config",
    "/.docker/config.json",
    "secrets",
    "credentials",
    "token",
    "apikey",
    "api_key",
    "private_key",
    ".pem",
    ".key",
    ".p12",
    ".pfx",
    "id_rsa",
    "id_ed25519",
    "id_ecdsa",
];

const ENV_PATTERNS: &[&str] = &[".env", ".env."];

const LAB_PATTERNS: &[&str] = &[
    "/lab/",
    "/labs/",
    "/sandbox/",
    "/experimental/",
    "/scratch/",
    "/spike/",
    "/poc/",
];

const ARTIFACT_OR_TEMP_PATTERNS: &[&str] = &[
    "/tmp/",
    "/temp/",
    "/artifacts/",
    "/dist/",
    "/build/",
    "/out/",
    "/target/",
    "/.cache/",
    "/node_modules/",
];

/// Every pattern here is anchored with a leading `/`, so a relative path never
/// matched one: `.ssh/known_hosts` does not contain `/.ssh/`, and `etc/passwd`
/// does not contain `/etc/passwd`. Callers pass worktree-relative paths, so the
/// deny gate was silently inert for exactly the paths it existed to stop.
/// Normalizing separators and rooting the path closes that, and erring toward
/// a match is the right direction for a deny gate.
fn normalize(path: &str) -> String {
    let lower = path.replace('\\', "/").to_lowercase();
    let collapsed = lower
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let mut rooted = String::with_capacity(lower.len() + 1);
    for part in collapsed {
        rooted.push('/');
        rooted.push_str(part);
    }
    if rooted.is_empty() {
        rooted.push('/');
    }
    // Keep a trailing slash for directory-shaped inputs so "/tmp/" style
    // patterns still match a directory argument.
    if lower.ends_with('/') && !rooted.ends_with('/') {
        rooted.push('/');
    }
    rooted
}

fn first_match<'a>(path: &str, patterns: &'a [&str]) -> Option<&'a str> {
    let normalized = normalize(path);
    patterns.iter().copied().find(|p| normalized.contains(p))
}

fn first_custom_match<'a>(path: &str, patterns: &'a [String]) -> Option<&'a str> {
    let normalized = normalize(path);
    patterns
        .iter()
        .find(|p| normalized.contains(&p.to_lowercase()))
        .map(String::as_str)
}

fn basename(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

fn is_env_example(path: &str) -> bool {
    basename(path).eq_ignore_ascii_case(".env.example")
}

fn classification(path: &str, zone: PathZone, reason: impl Into<String>) -> PathClassification {
    PathClassification {
        path: path.to_string(),
        zone,
        reason: Some(reason.into()),
    }
}

pub fn classify_path(
    path: &str,
    custom_forbidden: &[String],
    custom_sensitive: &[String],
) -> PathClassification {
    if let Some(pattern) = first_custom_match(path, custom_forbidden) {
        return classification(
            path,
            PathZone::Forbidden,
            format!("matches custom forbidden pattern: {pattern}"),
        );
    }
    if let Some(pattern) = first_match(path, FORBIDDEN_PATTERNS) {
        return classification(
            path,
            PathZone::Forbidden,
            format!("matches forbidden pattern: {pattern}"),
        );
    }

    if let Some(pattern) = first_custom_match(path, custom_sensitive) {
        return classification(
            path,
            PathZone::Sensitive,
            format!("matches custom sensitive pattern: {pattern}"),
        );
    }
    if let Some(pattern) = first_match(path, SENSITIVE_PATTERNS) {
        return classification(
            path,
            PathZone::Sensitive,
            format!("matches sensitive pattern: {pattern}"),
        );
    }

    if is_env_example(path) {
        return classification(
            path,
            PathZone::RepoSafe,
            "recognized committed environment template: .env.example",
        );
    }
    if let Some(pattern) = first_match(path, ENV_PATTERNS) {
        return classification(
            path,
            PathZone::Sensitive,
            format!("matches environment pattern: {pattern}"),
        );
    }

    if let Some(pattern) = first_match(path, LAB_PATTERNS) {
        return classification(
            path,
            PathZone::Lab,
            format!("matches lab pattern: {pattern}"),
        );
    }

    if let Some(pattern) = first_match(path, ARTIFACT_OR_TEMP_PATTERNS) {
        return classification(
            path,
            PathZone::ArtifactOrTemp,
            format!("matches artifact/temp pattern: {pattern}"),
        );
    }

    PathClassification {
        path: path.to_string(),
        zone: PathZone::RepoSafe,
        reason: None,
    }
}

pub fn classify_path_zone(
    path: &str,
    custom_forbidden: &[String],
    custom_sensitive: &[String],
) -> PathZone {
    classify_path(path, custom_forbidden, custom_sensitive).zone
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_paths_are_classified_like_absolute_ones() {
        // Callers pass worktree-relative paths. These used to land in RepoSafe
        // because every pattern is anchored with a leading slash.
        for path in [
            ".ssh/id_rsa",
            "etc/passwd",
            ".ssh/known_hosts",
            "etc/shadow",
        ] {
            let result = classify_path(path, &[], &[]);
            assert_ne!(
                result.zone,
                PathZone::RepoSafe,
                "relative path {path} must not be treated as repo-safe"
            );
        }
    }

    #[test]
    fn windows_separators_are_classified() {
        assert_ne!(
            classify_path("C:\\Users\\me\\.ssh\\id_rsa", &[], &[]).zone,
            PathZone::RepoSafe
        );
    }

    #[test]
    fn dax_credential_stores_are_sensitive() {
        for path in [
            "/home/u/.local/share/dax/auth.json",
            "/home/u/.aws/credentials",
            "/home/u/.netrc",
            "/home/u/.kube/config",
            "/home/u/.docker/config.json",
        ] {
            let result = classify_path(path, &[], &[]);
            assert_ne!(
                result.zone,
                PathZone::RepoSafe,
                "{path} must not be treated as repo-safe"
            );
        }
    }

    #[test]
    fn forbidden_ssh() {
        assert_eq!(
            classify_path_zone("/home/user/.ssh/id_rsa", &[], &[]),
            PathZone::Forbidden
        );
    }

    #[test]
    fn sensitive_env_file() {
        assert_eq!(
            classify_path_zone("/project/.env.production", &[], &[]),
            PathZone::Sensitive
        );
    }

    #[test]
    fn env_example_template_is_repo_safe() {
        assert_eq!(
            classify_path_zone("/project/.env.example", &[], &[]),
            PathZone::RepoSafe
        );
    }

    #[test]
    fn env_example_under_sensitive_path_is_sensitive() {
        assert_eq!(
            classify_path_zone("/project/secrets/.env.example", &[], &[]),
            PathZone::Sensitive
        );
    }

    #[test]
    fn lab_path() {
        assert_eq!(
            classify_path_zone("/project/lab/experiment.rs", &[], &[]),
            PathZone::Lab
        );
    }

    #[test]
    fn artifact_path() {
        assert_eq!(
            classify_path_zone("/project/dist/bundle.js", &[], &[]),
            PathZone::ArtifactOrTemp
        );
    }

    #[test]
    fn repo_safe() {
        assert_eq!(
            classify_path_zone("/project/src/main.rs", &[], &[]),
            PathZone::RepoSafe
        );
    }

    #[test]
    fn custom_forbidden_overrides() {
        assert_eq!(
            classify_path_zone(
                "/project/classified/data.json",
                &["classified".to_string()],
                &[]
            ),
            PathZone::Forbidden
        );
    }
}

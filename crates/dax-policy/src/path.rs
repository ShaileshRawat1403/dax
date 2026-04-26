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
    ".env",
    ".env.",
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

fn matches_any(path: &str, patterns: &[&str]) -> bool {
    let lower = path.to_lowercase();
    patterns.iter().any(|p| lower.contains(p))
}

pub fn classify_path_zone(
    path: &str,
    custom_forbidden: &[String],
    custom_sensitive: &[String],
) -> PathZone {
    let lower = path.to_lowercase();

    for p in custom_forbidden {
        if lower.contains(&p.to_lowercase()) {
            return PathZone::Forbidden;
        }
    }
    if matches_any(path, FORBIDDEN_PATTERNS) {
        return PathZone::Forbidden;
    }

    for p in custom_sensitive {
        if lower.contains(&p.to_lowercase()) {
            return PathZone::Sensitive;
        }
    }
    if matches_any(path, SENSITIVE_PATTERNS) {
        return PathZone::Sensitive;
    }

    if matches_any(path, LAB_PATTERNS) {
        return PathZone::Lab;
    }

    if matches_any(path, ARTIFACT_OR_TEMP_PATTERNS) {
        return PathZone::ArtifactOrTemp;
    }

    PathZone::RepoSafe
}

#[cfg(test)]
mod tests {
    use super::*;

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

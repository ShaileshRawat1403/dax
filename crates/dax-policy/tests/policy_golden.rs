use dax_policy::{evaluate, PolicyDecision, PolicyRequest};
use std::path::Path;

fn fixture_dir() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .leak()
}

fn load_request(name: &str) -> PolicyRequest {
    let path = fixture_dir().join(format!("{name}.request.json"));
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("failed to parse {}: {e}", path.display()))
}

fn load_golden(name: &str) -> PolicyDecision {
    let path = fixture_dir()
        .join("golden")
        .join(format!("{name}.decision.json"));
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("failed to parse {}: {e}", path.display()))
}

fn run_golden(name: &str) {
    let request = load_request(name);
    let golden = load_golden(name);
    let result = evaluate(&request);

    let result_json = serde_json::to_value(&result).expect("serialize result");
    let golden_json = serde_json::to_value(&golden).expect("serialize golden");

    assert_eq!(
        result_json, golden_json,
        "golden mismatch for {name}:\n  got:      {result_json}\n  expected: {golden_json}"
    );
}

#[test]
fn golden_allow_read() {
    run_golden("allow_read");
}

#[test]
fn golden_ask_sensitive_path() {
    run_golden("ask_sensitive_path");
}

#[test]
fn golden_deny_blocklisted() {
    run_golden("deny_blocklisted");
}

#[test]
fn golden_deny_budget_exhausted() {
    run_golden("deny_budget_exhausted");
}

#[test]
fn golden_ask_git_commit_strict() {
    run_golden("ask_git_commit_strict");
}

#[test]
fn golden_deny_forbidden_path() {
    run_golden("deny_forbidden_path");
}

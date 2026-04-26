use dax_audit::{evaluate, AuditInput, TrustReport};
use std::path::Path;

fn fixture_dir() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .leak()
}

fn load_input(name: &str) -> AuditInput {
    let path = fixture_dir().join(format!("{name}.input.json"));
    let text =
        std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()))
}

fn load_golden(name: &str) -> TrustReport {
    let path = fixture_dir()
        .join("golden")
        .join(format!("{name}.report.json"));
    let text =
        std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()))
}

fn run_golden(name: &str) {
    let input = load_input(name);
    let golden = load_golden(name);
    let result = evaluate(&input);

    let result_json = serde_json::to_value(&result).expect("serialize result");
    let golden_json = serde_json::to_value(&golden).expect("serialize golden");

    assert_eq!(
        result_json, golden_json,
        "golden mismatch for {name}:\n  got:      {result_json}\n  expected: {golden_json}"
    );
}

#[test]
fn golden_verified_clean() {
    run_golden("verified_clean");
}

#[test]
fn golden_policy_clean_warnings() {
    run_golden("policy_clean_warnings");
}

#[test]
fn golden_review_needed_blocker() {
    run_golden("review_needed_blocker");
}

#[test]
fn golden_review_needed_no_audit() {
    run_golden("review_needed_no_audit");
}

#[test]
fn golden_policy_clean_overrides() {
    run_golden("policy_clean_overrides");
}

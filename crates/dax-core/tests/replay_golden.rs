use dax_core::events::RunEvent;
use dax_core::reducer::replay_run_state;
use std::path::Path;

fn load_events(name: &str) -> Vec<RunEvent> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join(format!("{name}.events.json"));
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read fixture {name}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("cannot parse fixture {name}: {e}"))
}

fn load_golden(name: &str) -> serde_json::Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join("golden")
        .join(format!("{name}.state.json"));
    let raw =
        std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read golden {name}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("cannot parse golden {name}: {e}"))
}

fn assert_golden(fixture: &str) {
    let events = load_events(fixture);
    let state =
        replay_run_state(&events).unwrap_or_else(|e| panic!("replay failed for {fixture}: {e}"));
    let actual = serde_json::to_value(&state)
        .unwrap_or_else(|e| panic!("serialization failed for {fixture}: {e}"));
    let expected = load_golden(fixture);
    assert_eq!(
        actual, expected,
        "golden mismatch for {fixture} — run `cargo run -p dax-core-bin -- replay < fixtures/{fixture}.events.json` to inspect"
    );
}

#[test]
fn golden_basic_completed() {
    assert_golden("basic_completed");
}

#[test]
fn golden_approval_required() {
    assert_golden("approval_required");
}

#[test]
fn golden_failed_step() {
    assert_golden("failed_step");
}

#[test]
fn golden_policy_blocked() {
    assert_golden("policy_blocked");
}

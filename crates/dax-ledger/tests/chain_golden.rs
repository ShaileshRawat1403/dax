use dax_ledger::{append, verify_chain, ChainError};
use serde_json::json;

#[test]
fn verifies_golden_chain() {
    let first = append(
        None,
        &json!({ "kind": "run.created", "runId": "run_1" }),
        "2026-05-07T00:00:00Z",
    );
    let second = append(
        Some(&first),
        &json!({ "kind": "step.completed", "stepId": "step_1" }),
        "2026-05-07T00:00:01Z",
    );
    let third = append(
        Some(&second),
        &json!({ "kind": "run.completed", "runId": "run_1" }),
        "2026-05-07T00:00:02Z",
    );

    verify_chain(&[first, second, third]).expect("golden chain should verify");
}

#[test]
fn detects_reordered_entries() {
    let first = append(
        None,
        &json!({ "kind": "run.created" }),
        "2026-05-07T00:00:00Z",
    );
    let second = append(
        Some(&first),
        &json!({ "kind": "run.completed" }),
        "2026-05-07T00:00:01Z",
    );

    assert!(matches!(
        verify_chain(&[second, first]),
        Err(ChainError::Gap {
            expected: 0,
            got: 1
        })
    ));
}

#[test]
fn detects_forged_chain_hash() {
    let first = append(
        None,
        &json!({ "kind": "run.created" }),
        "2026-05-07T00:00:00Z",
    );
    let mut second = append(
        Some(&first),
        &json!({ "kind": "run.completed" }),
        "2026-05-07T00:00:01Z",
    );
    second.chain_hash = "sha256:forged".to_string();

    assert!(matches!(
        verify_chain(&[first, second]),
        Err(ChainError::Break { seq: 1, .. })
    ));
}

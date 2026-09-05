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

/// Pins the hash format itself.
///
/// The test above computes every hash at runtime, so it round-trips whatever
/// the implementation currently does and cannot notice a format change. These
/// values are the contract: the TypeScript side recomputes the same digests, so
/// changing the material that goes into a hash has to be a deliberate,
/// versioned decision rather than something a refactor can do silently.
#[test]
fn pins_the_hash_format() {
    let first = append(
        None,
        &json!({ "kind": "run.created", "runId": "run_1" }),
        "2026-05-07T00:00:00Z",
    );
    assert_eq!(
        first.body_hash,
        "sha256:e1ee39b445fbdad7de60a5364837cb5d681bab0870018e7f434fe3aae82fe5a8"
    );
    assert_eq!(
        first.chain_hash,
        "sha256:27ef5b60643f67dd66aab4392a7305814b988443dea69e2cf604d826d0cb86a7"
    );

    let second = append(
        Some(&first),
        &json!({ "kind": "step.completed", "stepId": "step_1" }),
        "2026-05-07T00:00:01Z",
    );
    assert_eq!(
        second.chain_hash,
        "sha256:3bbe9de2263351970c54ba777350aa02e0a951de96f3477db4ac894888314d3d"
    );
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

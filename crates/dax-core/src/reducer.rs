use crate::events::{EventPayload, RunEvent};
use crate::state::{RunError, RunState, RunStatus, StepError, StepRecord, StepStatus, StepType, TrustPosture, TrustSummary};
use crate::transitions::validate_transition;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ReplayError {
    #[error("empty event log — cannot reconstruct state")]
    EmptyLog,
    #[error("missing run.created event")]
    MissingCreationEvent,
    #[error("sequence gap: expected {expected} but got {got} at index {index}")]
    SequenceGap { expected: u32, got: u32, index: usize },
    #[error("illegal transition from {from:?} to {to:?} at sequence {sequence}")]
    IllegalTransition { from: RunStatus, to: RunStatus, sequence: u32 },
    #[error("unknown run status \"{status}\" at sequence {sequence}")]
    UnknownStatus { status: String, sequence: u32 },
}

/// Pure function: reconstructs canonical RunState from an ordered event log.
///
/// Same contract as replayRunState() in packages/dax/src/state/replay.ts.
/// Given the same events, always produces the same output.
pub fn replay_run_state(events: &[RunEvent]) -> Result<RunState, ReplayError> {
    if events.is_empty() {
        return Err(ReplayError::EmptyLog);
    }

    let mut sorted: Vec<&RunEvent> = events.iter().collect();
    sorted.sort_by_key(|e| e.sequence);

    for i in 1..sorted.len() {
        if sorted[i].sequence != sorted[i - 1].sequence + 1 {
            return Err(ReplayError::SequenceGap {
                expected: sorted[i - 1].sequence + 1,
                got: sorted[i].sequence,
                index: i,
            });
        }
    }

    let creation = sorted
        .iter()
        .find(|e| matches!(e.payload, EventPayload::RunCreated { .. }))
        .ok_or(ReplayError::MissingCreationEvent)?;

    let run_id = creation.run_id.clone();
    let mut state = RunState::new(run_id, creation.timestamp.clone());

    for event in &sorted {
        state.updated_at = event.timestamp.clone();

        match &event.payload {
            EventPayload::RunCreated { .. } => {
                // initial state already set above
            }

            EventPayload::RunStarted { .. } => {
                state.status = RunStatus::Running;
                if state.started_at.is_none() {
                    state.started_at = Some(event.timestamp.clone());
                }
            }

            EventPayload::RunStateChanged { current_status, .. } => {
                let next = parse_status(current_status, event.sequence)?;
                validate_transition(&state.status, &next).map_err(|_| ReplayError::IllegalTransition {
                    from: state.status.clone(),
                    to: next.clone(),
                    sequence: event.sequence,
                })?;
                state.status = next;
                if state.status == RunStatus::Running && state.started_at.is_none() {
                    state.started_at = Some(event.timestamp.clone());
                }
                if state.status.is_terminal() {
                    state.completed_at = Some(event.timestamp.clone());
                    state.current_step_id = None;
                }
            }

            EventPayload::RunCompleted { .. } => {
                state.status = RunStatus::Completed;
                state.completed_at = Some(event.timestamp.clone());
                state.current_step_id = None;
            }

            EventPayload::RunFailed { error, .. } => {
                state.status = RunStatus::Failed;
                state.completed_at = Some(event.timestamp.clone());
                state.current_step_id = None;
                state.error = Some(RunError {
                    code: error.code.clone(),
                    message: error.message.clone(),
                    retryable: error.retryable.unwrap_or(false),
                });
            }

            EventPayload::StepProposed { step_id, title, .. } => {
                state.steps.push(StepRecord {
                    step_id: step_id.clone(),
                    title: title.clone(),
                    step_type: StepType::Proposed,
                    status: StepStatus::Proposed,
                    started_at: None,
                    completed_at: None,
                    error: None,
                    outputs: Vec::new(),
                });
                state.current_step_id = Some(step_id.clone());
            }

            EventPayload::StepStarted { step_id, title, .. } => {
                match state.steps.iter_mut().find(|s| &s.step_id == step_id) {
                    Some(step) => {
                        step.status = StepStatus::Running;
                        step.started_at = Some(event.timestamp.clone());
                    }
                    None => {
                        // Older logs may not have a prior step.proposed
                        state.steps.push(StepRecord {
                            step_id: step_id.clone(),
                            title: title.clone(),
                            step_type: StepType::Executed,
                            status: StepStatus::Running,
                            started_at: Some(event.timestamp.clone()),
                            completed_at: None,
                            error: None,
                            outputs: Vec::new(),
                        });
                    }
                }
                state.current_step_id = Some(step_id.clone());
            }

            EventPayload::StepCompleted { step_id, .. } => {
                if let Some(step) = state.steps.iter_mut().find(|s| &s.step_id == step_id) {
                    step.status = StepStatus::Completed;
                    step.completed_at = Some(event.timestamp.clone());
                }
                if state.current_step_id.as_deref() == Some(step_id) {
                    state.current_step_id = None;
                }
            }

            EventPayload::StepFailed { step_id, error, .. } => {
                if let Some(step) = state.steps.iter_mut().find(|s| &s.step_id == step_id) {
                    step.status = StepStatus::Failed;
                    step.completed_at = Some(event.timestamp.clone());
                    step.error = Some(StepError {
                        code: error.code.clone(),
                        message: error.message.clone(),
                        retryable: error.retryable.unwrap_or(false),
                    });
                }
                if state.current_step_id.as_deref() == Some(step_id) {
                    state.current_step_id = None;
                }
            }

            EventPayload::ApprovalRequested { approval } => {
                if !state.pending_approval_ids.contains(&approval.approval_id) {
                    state.pending_approval_ids.push(approval.approval_id.clone());
                }
            }

            EventPayload::ApprovalResolved { approval_id, .. } => {
                state.pending_approval_ids.retain(|id| id != approval_id);
            }

            EventPayload::ArtifactCreated { artifact } => {
                if !state.artifact_ids.contains(&artifact.artifact_id) {
                    state.artifact_ids.push(artifact.artifact_id.clone());
                }
            }

            EventPayload::AuditPostureUpdated { trust } => {
                state.trust = Some(TrustSummary {
                    posture: match trust.posture.as_deref().unwrap_or("low") {
                        "guarded" => TrustPosture::Guarded,
                        "moderate" => TrustPosture::Moderate,
                        "strong" => TrustPosture::Strong,
                        _ => TrustPosture::Low,
                    },
                    score: trust.score,
                    blocked: trust.blocked.unwrap_or(false),
                    reasons: trust.reasons.clone().unwrap_or_default(),
                });
            }

            // Informational events — no state mutation
            EventPayload::IntentCreated { .. }
            | EventPayload::PlanCompiled { .. }
            | EventPayload::PlanStepPromoted { .. }
            | EventPayload::InterventionRequired { .. }
            | EventPayload::InterventionResolved { .. } => {}
        }
    }

    Ok(state)
}

fn parse_status(s: &str, sequence: u32) -> Result<RunStatus, ReplayError> {
    match s {
        "created" => Ok(RunStatus::Created),
        "compiled" => Ok(RunStatus::Compiled),
        "queued" => Ok(RunStatus::Queued),
        "running" => Ok(RunStatus::Running),
        "waiting_approval" => Ok(RunStatus::WaitingApproval),
        "completed" => Ok(RunStatus::Completed),
        "failed" => Ok(RunStatus::Failed),
        "cancelled" => Ok(RunStatus::Cancelled),
        _ => Err(ReplayError::UnknownStatus { status: s.to_string(), sequence }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{ApprovalSummary, ArtifactSummary, EventPayload, RunEvent, TrustUpdate};

    fn event(sequence: u32, payload: EventPayload) -> RunEvent {
        RunEvent {
            event_id: format!("evt_{sequence}"),
            sequence,
            cursor: format!("cursor_{sequence}"),
            run_id: "run_1".to_string(),
            timestamp: format!("2026-04-26T00:00:0{sequence}Z"),
            message: None,
            payload,
        }
    }

    #[test]
    fn replays_basic_completed_run() {
        let events = vec![
            event(1, EventPayload::RunCreated { status: "created".to_string(), title: Some("Test run".to_string()) }),
            event(2, EventPayload::RunStateChanged { previous_status: "created".to_string(), current_status: "compiled".to_string(), reason: Some("contract compiled".to_string()) }),
            event(3, EventPayload::RunStateChanged { previous_status: "compiled".to_string(), current_status: "queued".to_string(), reason: Some("queued".to_string()) }),
            event(4, EventPayload::RunStarted { status: "running".to_string() }),
            event(5, EventPayload::StepStarted { step_id: "step_1".to_string(), title: "Run tests".to_string(), detail: None }),
            event(6, EventPayload::StepCompleted { step_id: "step_1".to_string(), title: "Run tests".to_string(), duration_ms: Some(120) }),
            event(7, EventPayload::RunCompleted { status: "completed".to_string(), summary_available: true }),
        ];

        let state = replay_run_state(&events).expect("replay should pass");

        assert_eq!(state.run_id, "run_1");
        assert_eq!(state.status, RunStatus::Completed);
        assert_eq!(state.steps.len(), 1);
        assert_eq!(state.steps[0].status, StepStatus::Completed);
        assert!(state.pending_approval_ids.is_empty());
        assert_eq!(state.current_step_id, None);
        assert!(state.completed_at.is_some());
    }

    #[test]
    fn replays_pending_approval_then_resolution() {
        let events = vec![
            event(1, EventPayload::RunCreated { status: "created".to_string(), title: None }),
            event(2, EventPayload::RunStarted { status: "running".to_string() }),
            event(3, EventPayload::ApprovalRequested { approval: ApprovalSummary { approval_id: "approval_1".to_string() } }),
            event(4, EventPayload::RunStateChanged { previous_status: "running".to_string(), current_status: "waiting_approval".to_string(), reason: Some("approval required".to_string()) }),
            event(5, EventPayload::ApprovalResolved { approval_id: "approval_1".to_string(), decision: "allow".to_string(), resolved_at: "2026-04-26T00:00:05Z".to_string() }),
            event(6, EventPayload::RunStateChanged { previous_status: "waiting_approval".to_string(), current_status: "running".to_string(), reason: Some("approval resolved".to_string()) }),
        ];

        let state = replay_run_state(&events).expect("replay should pass");

        assert_eq!(state.status, RunStatus::Running);
        assert!(state.pending_approval_ids.is_empty());
    }

    #[test]
    fn keeps_unresolved_approval_pending() {
        let events = vec![
            event(1, EventPayload::RunCreated { status: "created".to_string(), title: None }),
            event(2, EventPayload::RunStarted { status: "running".to_string() }),
            event(3, EventPayload::ApprovalRequested { approval: ApprovalSummary { approval_id: "approval_1".to_string() } }),
        ];

        let state = replay_run_state(&events).expect("replay should pass");

        assert_eq!(state.pending_approval_ids, vec!["approval_1".to_string()]);
    }

    #[test]
    fn records_artifact_ids_once() {
        let events = vec![
            event(1, EventPayload::RunCreated { status: "created".to_string(), title: None }),
            event(2, EventPayload::ArtifactCreated { artifact: ArtifactSummary { artifact_id: "artifact_1".to_string() } }),
            event(3, EventPayload::ArtifactCreated { artifact: ArtifactSummary { artifact_id: "artifact_1".to_string() } }),
        ];

        let state = replay_run_state(&events).expect("replay should pass");

        assert_eq!(state.artifact_ids, vec!["artifact_1".to_string()]);
    }

    #[test]
    fn records_audit_posture() {
        let events = vec![
            event(1, EventPayload::RunCreated { status: "created".to_string(), title: None }),
            event(2, EventPayload::AuditPostureUpdated {
                trust: TrustUpdate {
                    posture: Some("strong".to_string()),
                    score: Some(91.0),
                    blocked: Some(false),
                    reasons: Some(vec!["evidence complete".to_string()]),
                },
            }),
        ];

        let state = replay_run_state(&events).expect("replay should pass");
        let trust = state.trust.expect("trust should be set");

        assert_eq!(trust.posture, TrustPosture::Strong);
        assert_eq!(trust.score, Some(91.0));
        assert!(!trust.blocked);
        assert_eq!(trust.reasons, vec!["evidence complete".to_string()]);
    }

    #[test]
    fn rejects_empty_event_log() {
        let err = replay_run_state(&[]).expect_err("empty log should fail");
        assert!(matches!(err, ReplayError::EmptyLog));
    }

    #[test]
    fn rejects_missing_creation_event() {
        let events = vec![event(1, EventPayload::RunStarted { status: "running".to_string() })];
        let err = replay_run_state(&events).expect_err("missing run.created should fail");
        assert!(matches!(err, ReplayError::MissingCreationEvent));
    }

    #[test]
    fn rejects_sequence_gap() {
        let events = vec![
            event(1, EventPayload::RunCreated { status: "created".to_string(), title: None }),
            event(3, EventPayload::RunStarted { status: "running".to_string() }),
        ];
        let err = replay_run_state(&events).expect_err("sequence gap should fail");
        assert!(matches!(err, ReplayError::SequenceGap { .. }));
    }

    #[test]
    fn produces_same_state_for_unsorted_input() {
        let ordered = vec![
            event(1, EventPayload::RunCreated { status: "created".to_string(), title: None }),
            event(2, EventPayload::RunStarted { status: "running".to_string() }),
        ];
        let unordered = vec![ordered[1].clone(), ordered[0].clone()];

        let a = replay_run_state(&ordered).expect("ordered replay should pass");
        let b = replay_run_state(&unordered).expect("unordered replay should pass");

        assert_eq!(serde_json::to_value(a).unwrap(), serde_json::to_value(b).unwrap());
    }

    #[test]
    fn rejects_illegal_transition() {
        let events = vec![
            event(1, EventPayload::RunCreated { status: "created".to_string(), title: None }),
            event(2, EventPayload::RunStateChanged {
                previous_status: "created".to_string(),
                current_status: "completed".to_string(),
                reason: Some("invalid direct completion".to_string()),
            }),
        ];
        let err = replay_run_state(&events).expect_err("illegal transition should fail");
        assert!(matches!(err, ReplayError::IllegalTransition { .. }));
    }

    #[test]
    fn rejects_unknown_status() {
        let events = vec![
            event(1, EventPayload::RunCreated { status: "created".to_string(), title: None }),
            event(2, EventPayload::RunStateChanged {
                previous_status: "created".to_string(),
                current_status: "teleported".to_string(),
                reason: None,
            }),
        ];
        let err = replay_run_state(&events).expect_err("unknown status should fail");
        assert!(matches!(err, ReplayError::UnknownStatus { .. }));
    }
}

use crate::events::{EventPayload, RunEvent};
use crate::state::{RunError, RunState, RunStatus, StepError, StepRecord, StepStatus, StepType, TrustPosture, TrustSummary};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ReplayError {
    #[error("empty event log — cannot reconstruct state")]
    EmptyLog,
    #[error("missing run.created event")]
    MissingCreationEvent,
    #[error("sequence gap: expected {expected} but got {got} at index {index}")]
    SequenceGap { expected: u32, got: u32, index: usize },
    #[error("step not found: {step_id}")]
    StepNotFound { step_id: String },
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
                state.status = parse_status(current_status);
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

fn parse_status(s: &str) -> RunStatus {
    match s {
        "created" => RunStatus::Created,
        "compiled" => RunStatus::Compiled,
        "queued" => RunStatus::Queued,
        "running" => RunStatus::Running,
        "waiting_approval" => RunStatus::WaitingApproval,
        "completed" => RunStatus::Completed,
        "failed" => RunStatus::Failed,
        "cancelled" => RunStatus::Cancelled,
        _ => RunStatus::Failed,
    }
}

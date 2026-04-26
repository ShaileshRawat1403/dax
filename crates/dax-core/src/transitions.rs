use crate::state::RunStatus;
use thiserror::Error;

#[derive(Debug, Error)]
#[error("illegal transition from \"{from}\" to \"{to}\"")]
pub struct IllegalTransitionError {
    pub from: String,
    pub to: String,
}

/// Mirrors LEGAL_TRANSITIONS from packages/dax/src/state/run-state.ts
pub fn legal_targets(from: &RunStatus) -> &'static [RunStatus] {
    match from {
        RunStatus::Created => &[RunStatus::Compiled, RunStatus::Cancelled],
        RunStatus::Compiled => &[RunStatus::Queued, RunStatus::Cancelled],
        RunStatus::Queued => &[RunStatus::Running, RunStatus::Cancelled],
        RunStatus::Running => &[
            RunStatus::WaitingApproval,
            RunStatus::Completed,
            RunStatus::Failed,
            RunStatus::Cancelled,
        ],
        RunStatus::WaitingApproval => {
            &[RunStatus::Running, RunStatus::Cancelled, RunStatus::Failed]
        }
        RunStatus::Completed | RunStatus::Failed | RunStatus::Cancelled => &[],
    }
}

pub fn validate_transition(from: &RunStatus, to: &RunStatus) -> Result<(), IllegalTransitionError> {
    if legal_targets(from).contains(to) {
        Ok(())
    } else {
        Err(IllegalTransitionError {
            from: format!("{from:?}"),
            to: format!("{to:?}"),
        })
    }
}

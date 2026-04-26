use serde::{Deserialize, Serialize};

/// Mirrors TypeScript RunStatus enum from packages/dax/src/state/run-state.ts
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Created,
    Compiled,
    Queued,
    Running,
    WaitingApproval,
    Completed,
    Failed,
    Cancelled,
}

impl RunStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Proposed,
    Running,
    Completed,
    Failed,
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StepType {
    Proposed,
    Executed,
    Approved,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustPosture {
    Low,
    Guarded,
    Moderate,
    Strong,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StepError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StepRecord {
    #[serde(rename = "stepId")]
    pub step_id: String,
    pub title: String,
    #[serde(rename = "type")]
    pub step_type: StepType,
    pub status: StepStatus,
    #[serde(rename = "startedAt")]
    pub started_at: Option<String>,
    #[serde(rename = "completedAt")]
    pub completed_at: Option<String>,
    pub error: Option<StepError>,
    pub outputs: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TrustSummary {
    pub posture: TrustPosture,
    pub score: Option<f64>,
    pub blocked: bool,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RunError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RunState {
    #[serde(rename = "runId")]
    pub run_id: String,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub status: RunStatus,
    #[serde(rename = "currentStepId")]
    pub current_step_id: Option<String>,
    pub steps: Vec<StepRecord>,
    #[serde(rename = "pendingApprovalIds")]
    pub pending_approval_ids: Vec<String>,
    #[serde(rename = "artifactIds")]
    pub artifact_ids: Vec<String>,
    pub trust: Option<TrustSummary>,
    pub error: Option<RunError>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "startedAt")]
    pub started_at: Option<String>,
    #[serde(rename = "completedAt")]
    pub completed_at: Option<String>,
}

impl RunState {
    pub fn new(run_id: String, timestamp: String) -> Self {
        Self {
            run_id,
            contract_id: String::from("unknown_contract"),
            status: RunStatus::Created,
            current_step_id: None,
            steps: Vec::new(),
            pending_approval_ids: Vec::new(),
            artifact_ids: Vec::new(),
            trust: None,
            error: None,
            created_at: timestamp.clone(),
            updated_at: timestamp,
            started_at: None,
            completed_at: None,
        }
    }
}

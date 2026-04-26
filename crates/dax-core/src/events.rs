use serde::{Deserialize, Serialize};

/// Mirrors all event types from packages/dax/src/server/run-contract.ts RunEventType
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", content = "payload")]
pub enum EventPayload {
    #[serde(rename = "run.created")]
    RunCreated { status: String, title: Option<String> },

    #[serde(rename = "run.started")]
    RunStarted { status: String },

    #[serde(rename = "run.state_changed")]
    RunStateChanged {
        #[serde(rename = "previousStatus")]
        previous_status: String,
        #[serde(rename = "currentStatus")]
        current_status: String,
        reason: Option<String>,
    },

    #[serde(rename = "run.completed")]
    RunCompleted {
        status: String,
        #[serde(rename = "summaryAvailable")]
        summary_available: bool,
    },

    #[serde(rename = "run.failed")]
    RunFailed {
        status: String,
        error: EventError,
    },

    #[serde(rename = "step.proposed")]
    StepProposed {
        #[serde(rename = "stepId")]
        step_id: String,
        title: String,
        detail: Option<String>,
    },

    #[serde(rename = "step.started")]
    StepStarted {
        #[serde(rename = "stepId")]
        step_id: String,
        title: String,
        detail: Option<String>,
    },

    #[serde(rename = "step.completed")]
    StepCompleted {
        #[serde(rename = "stepId")]
        step_id: String,
        title: String,
        #[serde(rename = "durationMs")]
        duration_ms: Option<u64>,
    },

    #[serde(rename = "step.failed")]
    StepFailed {
        #[serde(rename = "stepId")]
        step_id: String,
        title: String,
        error: EventError,
    },

    #[serde(rename = "approval.requested")]
    ApprovalRequested {
        approval: ApprovalSummary,
    },

    #[serde(rename = "approval.resolved")]
    ApprovalResolved {
        #[serde(rename = "approvalId")]
        approval_id: String,
        decision: String,
        #[serde(rename = "resolvedAt")]
        resolved_at: String,
    },

    #[serde(rename = "artifact.created")]
    ArtifactCreated {
        artifact: ArtifactSummary,
    },

    #[serde(rename = "audit.posture_updated")]
    AuditPostureUpdated {
        trust: TrustUpdate,
    },

    #[serde(rename = "intent.created")]
    IntentCreated {
        #[serde(rename = "intentType")]
        intent_type: String,
        goal: String,
    },

    #[serde(rename = "plan.compiled")]
    PlanCompiled {
        #[serde(rename = "planId")]
        plan_id: String,
    },

    #[serde(rename = "plan.step_promoted")]
    PlanStepPromoted {
        #[serde(rename = "stepId")]
        step_id: String,
        status: String,
    },

    #[serde(rename = "intervention.required")]
    InterventionRequired {
        #[serde(rename = "interventionId")]
        intervention_id: String,
        reason: String,
    },

    #[serde(rename = "intervention.resolved")]
    InterventionResolved {
        #[serde(rename = "interventionId")]
        intervention_id: String,
        status: String,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EventError {
    pub code: String,
    pub message: String,
    pub retryable: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ApprovalSummary {
    #[serde(rename = "approvalId")]
    pub approval_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ArtifactSummary {
    #[serde(rename = "artifactId")]
    pub artifact_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TrustUpdate {
    pub posture: Option<String>,
    pub score: Option<f64>,
    pub blocked: Option<bool>,
    pub reasons: Option<Vec<String>>,
}

/// The full event envelope as stored in the DAX event log.
/// Mirrors RunEvent from packages/dax/src/server/run-contract.ts
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RunEvent {
    #[serde(rename = "eventId")]
    pub event_id: String,
    pub sequence: u32,
    pub cursor: String,
    #[serde(rename = "runId")]
    pub run_id: String,
    pub timestamp: String,
    pub message: Option<String>,
    #[serde(flatten)]
    pub payload: EventPayload,
}

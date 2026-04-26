use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Allow,
    Ask,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyDecision {
    pub schema_version: String,
    pub decision: Decision,
    pub risk: RiskLevel,
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gate: Option<String>,
}

const SCHEMA_VERSION: &str = "dax.policy.decision.v1";

impl PolicyDecision {
    pub fn allow(risk: RiskLevel, reason: impl Into<String>) -> Self {
        Self {
            schema_version: SCHEMA_VERSION.to_string(),
            decision: Decision::Allow,
            risk,
            reason: reason.into(),
            gate: None,
        }
    }

    pub fn ask(risk: RiskLevel, reason: impl Into<String>, gate: impl Into<String>) -> Self {
        Self {
            schema_version: SCHEMA_VERSION.to_string(),
            decision: Decision::Ask,
            risk,
            reason: reason.into(),
            gate: Some(gate.into()),
        }
    }

    pub fn deny(risk: RiskLevel, reason: impl Into<String>) -> Self {
        Self {
            schema_version: SCHEMA_VERSION.to_string(),
            decision: Decision::Deny,
            risk,
            reason: reason.into(),
            gate: None,
        }
    }
}

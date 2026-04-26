use crate::check::{AuditCheck, CheckId, CheckStatus};
use crate::input::{AuditFinding, AuditInput, AuditSeverity};
use crate::posture::{TrustPostureLevel, TrustReport, VerificationResult};
use dax_core::reducer::replay_run_state;
use dax_core::state::{RunStatus, StepStatus};

struct RunSignals {
    pending_approval_count: usize,
    artifact_count: usize,
    completed_step_count: usize,
    run_terminal: bool,
}

fn derive_signals(input: &AuditInput) -> RunSignals {
    match replay_run_state(&input.events) {
        Ok(state) => {
            let completed_steps = state
                .steps
                .iter()
                .filter(|s| s.status == StepStatus::Completed)
                .count();
            let terminal = matches!(
                state.status,
                RunStatus::Completed | RunStatus::Failed | RunStatus::Cancelled
            );
            RunSignals {
                pending_approval_count: state.pending_approval_ids.len(),
                artifact_count: state.artifact_ids.len(),
                completed_step_count: completed_steps,
                run_terminal: terminal,
            }
        }
        Err(_) => RunSignals {
            pending_approval_count: 0,
            artifact_count: 0,
            completed_step_count: 0,
            run_terminal: false,
        },
    }
}

fn check_approval_compliance(pending: usize) -> AuditCheck {
    if pending > 0 {
        AuditCheck {
            id: CheckId::ApprovalCompliance,
            label: "Approval Compliance".to_string(),
            status: CheckStatus::Incomplete,
            summary: format!("{pending} pending approval request(s) remain."),
        }
    } else {
        AuditCheck {
            id: CheckId::ApprovalCompliance,
            label: "Approval Compliance".to_string(),
            status: CheckStatus::Pass,
            summary: "No pending approvals.".to_string(),
        }
    }
}

fn check_policy_compliance(findings: &[AuditFinding], audit_present: bool) -> AuditCheck {
    if !audit_present {
        return AuditCheck {
            id: CheckId::PolicyCompliance,
            label: "Policy Compliance".to_string(),
            status: CheckStatus::Incomplete,
            summary: "No audit has been performed for this session.".to_string(),
        };
    }
    let blocker_count = findings.iter().filter(|f| f.blocking).count();
    let warning_count = findings
        .iter()
        .filter(|f| !f.blocking && f.severity != AuditSeverity::Info)
        .count();
    if blocker_count > 0 {
        AuditCheck {
            id: CheckId::PolicyCompliance,
            label: "Policy Compliance".to_string(),
            status: CheckStatus::Fail,
            summary: format!("{blocker_count} critical policy blocker(s) were identified."),
        }
    } else if warning_count > 0 {
        AuditCheck {
            id: CheckId::PolicyCompliance,
            label: "Policy Compliance".to_string(),
            status: CheckStatus::Warn,
            summary: format!("{warning_count} policy warning(s) should be reviewed."),
        }
    } else {
        AuditCheck {
            id: CheckId::PolicyCompliance,
            label: "Policy Compliance".to_string(),
            status: CheckStatus::Pass,
            summary: "Session is compliant with current policies.".to_string(),
        }
    }
}

fn check_artifact_presence(artifact_count: usize, run_terminal: bool) -> AuditCheck {
    if artifact_count > 0 {
        AuditCheck {
            id: CheckId::ArtifactPresence,
            label: "Artifact Presence".to_string(),
            status: CheckStatus::Pass,
            summary: format!("{artifact_count} artifact(s) recorded."),
        }
    } else if run_terminal {
        AuditCheck {
            id: CheckId::ArtifactPresence,
            label: "Artifact Presence".to_string(),
            status: CheckStatus::Warn,
            summary: "Run completed without recording any artifacts.".to_string(),
        }
    } else {
        AuditCheck {
            id: CheckId::ArtifactPresence,
            label: "Artifact Presence".to_string(),
            status: CheckStatus::Incomplete,
            summary: "Run has not yet produced artifacts.".to_string(),
        }
    }
}

fn check_evidence_completeness(policy_decision_count: u32) -> AuditCheck {
    if policy_decision_count > 0 {
        AuditCheck {
            id: CheckId::EvidenceCompleteness,
            label: "Evidence Completeness".to_string(),
            status: CheckStatus::Pass,
            summary: format!("{policy_decision_count} policy decision(s) recorded as evidence."),
        }
    } else {
        AuditCheck {
            id: CheckId::EvidenceCompleteness,
            label: "Evidence Completeness".to_string(),
            status: CheckStatus::Incomplete,
            summary: "No policy decisions were recorded for this session.".to_string(),
        }
    }
}

fn check_trace_continuity(completed_step_count: usize) -> AuditCheck {
    if completed_step_count > 0 {
        AuditCheck {
            id: CheckId::TraceContiguity,
            label: "Trace Continuity".to_string(),
            status: CheckStatus::Pass,
            summary: format!("Trace contains {completed_step_count} completed step(s)."),
        }
    } else {
        AuditCheck {
            id: CheckId::TraceContiguity,
            label: "Trace Continuity".to_string(),
            status: CheckStatus::Incomplete,
            summary: "No completed steps recorded in the run trace.".to_string(),
        }
    }
}

fn check_overrides_justified(override_count: u32) -> AuditCheck {
    if override_count == 0 {
        AuditCheck {
            id: CheckId::OverridesJustified,
            label: "Overrides Justified".to_string(),
            status: CheckStatus::Pass,
            summary: "No governance overrides were recorded.".to_string(),
        }
    } else {
        AuditCheck {
            id: CheckId::OverridesJustified,
            label: "Overrides Justified".to_string(),
            status: CheckStatus::Warn,
            summary: format!("{override_count} governance override(s) require review."),
        }
    }
}

pub fn evaluate(input: &AuditInput) -> TrustReport {
    let signals = derive_signals(input);

    let checks = vec![
        check_approval_compliance(signals.pending_approval_count),
        check_policy_compliance(&input.findings, input.audit_present),
        check_artifact_presence(signals.artifact_count, signals.run_terminal),
        check_evidence_completeness(input.policy_decision_count),
        check_trace_continuity(signals.completed_step_count),
        check_overrides_justified(input.override_count),
    ];

    let blocking_factors: Vec<String> = checks
        .iter()
        .filter(|c| c.status == CheckStatus::Fail)
        .map(|c| c.summary.clone())
        .collect();
    let missing_evidence: Vec<String> = checks
        .iter()
        .filter(|c| c.status == CheckStatus::Incomplete)
        .map(|c| c.summary.clone())
        .collect();
    let degrading_factors: Vec<String> = checks
        .iter()
        .filter(|c| c.status == CheckStatus::Warn)
        .map(|c| c.summary.clone())
        .collect();
    let passing_signals: Vec<String> = checks
        .iter()
        .filter(|c| c.status == CheckStatus::Pass)
        .map(|c| c.summary.clone())
        .collect();

    let verification_result = if !blocking_factors.is_empty() {
        VerificationResult::Failed
    } else if !missing_evidence.is_empty() {
        VerificationResult::Incomplete
    } else if !degrading_factors.is_empty() {
        VerificationResult::Degraded
    } else {
        VerificationResult::Passed
    };

    let posture = match &verification_result {
        VerificationResult::Failed | VerificationResult::Incomplete => {
            TrustPostureLevel::ReviewNeeded
        }
        VerificationResult::Degraded => TrustPostureLevel::PolicyClean,
        VerificationResult::Passed => {
            if input.override_count > 0 {
                TrustPostureLevel::PolicyClean
            } else {
                TrustPostureLevel::Verified
            }
        }
    };

    TrustReport {
        schema_version: "dax.audit.v1".to_string(),
        session_id: input.session_id.clone(),
        posture,
        verification_result,
        checks,
        blocking_factors,
        missing_evidence,
        degrading_factors,
        passing_signals,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::input::AuditFinding;
    use dax_core::events::RunEvent;

    fn base_events(run_id: &str) -> Vec<RunEvent> {
        serde_json::from_str(&format!(
            r#"[
                {{"eventId":"e1","sequence":1,"cursor":"c1","runId":"{run_id}","timestamp":"2026-04-26T10:00:00Z","type":"run.created","payload":{{"status":"created","title":"test"}}}},
                {{"eventId":"e2","sequence":2,"cursor":"c2","runId":"{run_id}","timestamp":"2026-04-26T10:00:01Z","type":"run.started","payload":{{"status":"running"}}}},
                {{"eventId":"e3","sequence":3,"cursor":"c3","runId":"{run_id}","timestamp":"2026-04-26T10:00:02Z","type":"step.proposed","payload":{{"stepId":"s1","title":"step"}}}},
                {{"eventId":"e4","sequence":4,"cursor":"c4","runId":"{run_id}","timestamp":"2026-04-26T10:00:03Z","type":"step.started","payload":{{"stepId":"s1","title":"step"}}}},
                {{"eventId":"e5","sequence":5,"cursor":"c5","runId":"{run_id}","timestamp":"2026-04-26T10:00:04Z","type":"step.completed","payload":{{"stepId":"s1","title":"step","durationMs":100}}}},
                {{"eventId":"e6","sequence":6,"cursor":"c6","runId":"{run_id}","timestamp":"2026-04-26T10:00:05Z","type":"artifact.created","payload":{{"artifact":{{"artifactId":"art_1"}}}}}},
                {{"eventId":"e7","sequence":7,"cursor":"c7","runId":"{run_id}","timestamp":"2026-04-26T10:00:06Z","type":"run.completed","payload":{{"status":"completed","summaryAvailable":true}}}}
            ]"#
        )).unwrap()
    }

    fn make_finding(blocking: bool, severity: AuditSeverity) -> AuditFinding {
        AuditFinding {
            id: "test.finding".to_string(),
            severity,
            category: "test".to_string(),
            title: "Test finding".to_string(),
            blocking,
        }
    }

    #[test]
    fn verified_clean_run() {
        let input = AuditInput {
            session_id: "ses_verified".to_string(),
            events: base_events("run_verified"),
            findings: vec![],
            policy_decision_count: 5,
            override_count: 0,
            audit_present: true,
        };
        let report = evaluate(&input);
        assert_eq!(report.posture, TrustPostureLevel::Verified);
        assert_eq!(report.verification_result, VerificationResult::Passed);
        assert!(report.blocking_factors.is_empty());
    }

    #[test]
    fn policy_clean_with_warnings() {
        let input = AuditInput {
            session_id: "ses_clean".to_string(),
            events: base_events("run_clean"),
            findings: vec![make_finding(false, AuditSeverity::Medium)],
            policy_decision_count: 3,
            override_count: 0,
            audit_present: true,
        };
        let report = evaluate(&input);
        assert_eq!(report.posture, TrustPostureLevel::PolicyClean);
        assert_eq!(report.verification_result, VerificationResult::Degraded);
    }

    #[test]
    fn review_needed_on_blocker() {
        let input = AuditInput {
            session_id: "ses_review".to_string(),
            events: base_events("run_review"),
            findings: vec![make_finding(true, AuditSeverity::Critical)],
            policy_decision_count: 2,
            override_count: 0,
            audit_present: true,
        };
        let report = evaluate(&input);
        assert_eq!(report.posture, TrustPostureLevel::ReviewNeeded);
        assert_eq!(report.verification_result, VerificationResult::Failed);
        assert!(!report.blocking_factors.is_empty());
    }

    #[test]
    fn review_needed_no_audit() {
        let input = AuditInput {
            session_id: "ses_noaudit".to_string(),
            events: base_events("run_noaudit"),
            findings: vec![],
            policy_decision_count: 0,
            override_count: 0,
            audit_present: false,
        };
        let report = evaluate(&input);
        // No audit + no policy decisions → Incomplete → ReviewNeeded
        assert_eq!(report.posture, TrustPostureLevel::ReviewNeeded);
        assert_eq!(report.verification_result, VerificationResult::Incomplete);
    }

    #[test]
    fn policy_clean_with_overrides() {
        let input = AuditInput {
            session_id: "ses_overrides".to_string(),
            events: base_events("run_overrides"),
            findings: vec![],
            policy_decision_count: 4,
            override_count: 2,
            audit_present: true,
        };
        let report = evaluate(&input);
        // Overrides present → PolicyClean even when no blockers/warnings
        assert_eq!(report.posture, TrustPostureLevel::PolicyClean);
    }
}

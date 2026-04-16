export const DAX_SETTING = {
  explain_mode: "explain_mode",
  policy_profile: "policy_profile",
  eli12_summary_visibility: "eli12_summary_visibility",
  session_pane_visibility: "session_pane_visibility",
  session_pane_mode: "session_pane_mode",
  session_pane_follow_mode: "session_pane_follow_mode",
  session_workflow_mode: "session_workflow_mode",
  session_pm_tab: "session_pm_tab",

  toast_position: "toast_position",
  toast_style: "toast_style",
  session_preferred_name_prefix: "session_preferred_name_prefix",
  preferred_name_default: "preferred_name_default",
  session_refined_prompt: "session_refined_prompt",
  session_persona: "session_persona",
  display_mode: "display_mode",
  intervention_queue_visible: "intervention_queue_visible",

  operator_instruction: "operator_instruction",
  operator_session_tag: "operator_session_tag",
  operator_speed: "operator_speed",
  operator_verbosity: "operator_verbosity",
  operator_risk: "operator_risk",
  operator_approval: "operator_approval",
} as const

export function sessionWorkflowModeKey(sessionID?: string) {
  return sessionID ? `${DAX_SETTING.session_workflow_mode}:${sessionID}` : DAX_SETTING.session_workflow_mode
}

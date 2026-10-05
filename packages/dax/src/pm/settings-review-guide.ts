/** The legacy command never silently creates or approves replacement authority. */
export const PROJECT_SETTINGS_REVIEW_GUIDE = [
  "This project uses approved journal settings. This command made no change.",
  "Inspect GET /project/settings/review-input through the protected operator API.",
  "Propose project_settings_replaced via POST /project/facts/candidates with a governing runId,",
  "a new pfc_ candidate ID, the full desired snapshot and the exact priorSettingsEventId.",
  "Inspect the candidate, then explicitly review its exact digest and actor via",
  "POST /project/facts/candidates/:candidateID/review. Approval is required before publication.",
].join("\n")

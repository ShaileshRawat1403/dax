// Test preload script — runs before each test file.
//
// The runtime guard's pause-and-await behavior (see
// packages/dax/src/execution/runtime-guard.ts) defaults to a 10-minute
// wait for operator approval. In tests there is no operator, so we
// short-circuit the wait so violation paths reject immediately. Tests
// that want to verify the approve-decision path emit
// Lifecycle.ApprovalResolved themselves before awaiting the guard.
if (process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS === undefined) {
  process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS = "0"
}

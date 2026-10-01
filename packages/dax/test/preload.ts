// Test preload for the @dax-ai/dax package.
//
// The runtime guard's pause-and-await behavior (see
// src/execution/runtime-guard.ts) defaults to a 10-minute wait for operator
// approval. In tests there is no operator, so we short-circuit the wait so
// violation paths reject immediately. Tests that want to verify the
// approve-decision path emit Lifecycle.ApprovalResolved themselves before
// awaiting the guard.
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Keep the test process away from the operator's real DAX history. Individual
// tests may override DAX_TEST_HOME, but their previous value is now another
// disposable home rather than the production storage root.
if (process.env.DAX_TEST_HOME === undefined) {
  process.env.DAX_TEST_HOME = mkdtempSync(join(tmpdir(), "dax-test-home-"))
}

// The PM database path is fixed when its module first loads. Load it here,
// against the disposable home above, so its open file never lives inside a
// home that a test sets and later deletes. A test that loaded it first left
// every later PM read failing with SQLITE_IOERR_VNODE, in file-order-dependent
// ways.
await import("../src/pm")

if (process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS === undefined) {
  process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS = "0"
}

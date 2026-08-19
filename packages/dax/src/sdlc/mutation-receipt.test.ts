import { describe, expect, test } from "bun:test"
import { createMutationReceipt } from "./mutation-receipt"

const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-const x = 1
+const x = 2
`

describe("mutation receipt", () => {
  test("digests the diff, so a receipt cannot be reattached to other content", () => {
    const a = createMutationReceipt({ runId: "run_1", changedPaths: ["src/a.ts"], diff: DIFF })
    const b = createMutationReceipt({ runId: "run_1", changedPaths: ["src/a.ts"], diff: DIFF })
    const different = createMutationReceipt({
      runId: "run_1",
      changedPaths: ["src/a.ts"],
      diff: DIFF.replace("const x = 2", "const x = 3"),
    })

    // Same content, same digest — the receipt commits to the change itself.
    expect(a.digest).toBe(b.digest)
    expect(a.digest).not.toBe(different.digest)
    expect(a.digest).toMatch(/^[a-f0-9]{64}$/)
  })

  test("each receipt is individually identifiable", () => {
    const a = createMutationReceipt({ runId: "run_1", changedPaths: ["src/a.ts"], diff: DIFF })
    const b = createMutationReceipt({ runId: "run_1", changedPaths: ["src/a.ts"], diff: DIFF })

    // Equal digests, distinct ids: two attestations of the same change are two
    // records, not one.
    expect(a.receiptId).not.toBe(b.receiptId)
  })

  test("the claim states what changed in operator terms", () => {
    const one = createMutationReceipt({ runId: "run_1", changedPaths: ["src/a.ts"], diff: DIFF })
    const many = createMutationReceipt({
      runId: "run_1",
      changedPaths: ["src/a.ts", "src/b.ts", "src/c.ts"],
      diff: DIFF,
    })

    expect(one.claim).toBe("1 file changed")
    expect(many.claim).toBe("3 files changed")
  })

  test("records the paths given, without inferring any", () => {
    // The caller passes kernel-computed paths. This function must not add to them
    // or reorder them — the receipt attests what was observed, not what is likely.
    const receipt = createMutationReceipt({
      runId: "run_1",
      changedPaths: ["src/b.ts", "src/a.ts"],
      diff: DIFF,
    })

    expect(receipt.changedPaths).toEqual(["src/b.ts", "src/a.ts"])
  })

  test("an empty change set is representable rather than rejected", () => {
    // Whether an empty diff should reach here is the caller's judgement;
    // worker-run refuses one earlier. The receipt stays honest about it either way.
    const receipt = createMutationReceipt({ runId: "run_1", changedPaths: [], diff: "" })

    expect(receipt.claim).toBe("0 files changed")
    expect(receipt.changedPaths).toEqual([])
  })
})

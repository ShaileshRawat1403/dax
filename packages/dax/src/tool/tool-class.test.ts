import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "fs"
import { join } from "path"
import {
  EDIT_TOOL_IDS,
  READ_TOOL_IDS,
  SHELL_TOOL_IDS,
  isEditTool,
  isMutatingTool,
  isReadTool,
  permissionForToolId,
} from "./tool-class"

/**
 * Tools that are neither file reads nor workspace mutations for classification
 * purposes: planning, session bookkeeping, task orchestration, memory notes,
 * and the invalid sentinel. `git_branch` and `batch` are listed here to
 * preserve the compiler's existing read-only behavior (they were never in its
 * edit/shell exclusion); tightening them is a separate policy decision, not part
 * of this drift fix. Listed explicitly so the coverage guard forces a deliberate
 * choice whenever a new tool is added.
 */
const NEUTRAL_TOOL_IDS = new Set<string>([
  "task",
  "todowrite",
  "todoread",
  "question",
  "skill",
  "pm_note",
  "reflection",
  "invalid",
  "plan_enter",
  "plan_exit",
  "git_branch",
  "batch",
])

/** Every `Tool.define("id")` declared anywhere in this directory. */
function discoverToolIds(): string[] {
  const dir = import.meta.dir
  const ids = new Set<string>()
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue
    const src = readFileSync(join(dir, file), "utf8")
    for (const match of src.matchAll(/Tool\.define\("([^"]+)"/g)) ids.add(match[1])
  }
  return [...ids]
}

describe("tool classification", () => {
  test("every declared tool id is classified — drift guard", () => {
    const unclassified = discoverToolIds().filter(
      (id) => !isReadTool(id) && !isMutatingTool(id) && !NEUTRAL_TOOL_IDS.has(id),
    )
    // If this fails, a new tool was added without a class. Classify it in
    // tool-class.ts (read / edit / shell) or add it to NEUTRAL_TOOL_IDS above.
    expect(unclassified).toEqual([])
  })

  test("the edit family maps to the edit permission", () => {
    for (const id of [...EDIT_TOOL_IDS, "patch"]) {
      expect(isEditTool(id)).toBeTrue()
      expect(isMutatingTool(id)).toBeTrue()
      expect(permissionForToolId(id)).toBe("edit")
    }
  })

  test("regression: apply_patch and multiedit are edits, phantom 'apply' is not", () => {
    // The compiler previously listed "apply" (no such tool) and missed the real
    // apply_patch and multiedit, letting a read-only run keep edit power.
    expect(isEditTool("apply_patch")).toBeTrue()
    expect(isEditTool("multiedit")).toBeTrue()
    expect(isEditTool("apply")).toBeFalse()
  })

  test("shell tools are mutating but not edits", () => {
    for (const id of SHELL_TOOL_IDS) {
      expect(isMutatingTool(id)).toBeTrue()
      expect(isEditTool(id)).toBeFalse()
      expect(permissionForToolId(id)).toBe("shell")
    }
  })

  test("read tools are read-only and never mutating", () => {
    for (const id of READ_TOOL_IDS) {
      expect(isReadTool(id)).toBeTrue()
      expect(isMutatingTool(id)).toBeFalse()
      expect(permissionForToolId(id)).toBe(id)
    }
  })
})

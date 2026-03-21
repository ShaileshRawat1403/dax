import { describe, test, expect, beforeEach } from "bun:test"
import { isFixedWorkflow, getStepsForWorkflow, FIXED_STEPS } from "../../src/workflows/types"
import { WorkflowRegistry, isWorkflowAvailable, listAvailableWorkflows } from "../../src/workflows/registry"

describe("Workflow Types", () => {
  test("isFixedWorkflow returns true for draft_and_approve", () => {
    expect(isFixedWorkflow("draft_and_approve")).toBe(true)
  })

  test("isFixedWorkflow returns true for repo_analyze", () => {
    expect(isFixedWorkflow("repo_analyze")).toBe(true)
  })

  test("isFixedWorkflow returns true for review_and_signoff", () => {
    expect(isFixedWorkflow("review_and_signoff")).toBe(true)
  })

  test("isFixedWorkflow returns false for other workflows", () => {
    expect(isFixedWorkflow("generic")).toBe(false)
  })

  test("getStepsForWorkflow returns fixed steps for draft_and_approve", () => {
    const steps = getStepsForWorkflow("draft_and_approve")
    expect(steps).toHaveLength(3)
    expect(steps[0].type).toBe("prepare_draft")
    expect(steps[1].type).toBe("request_approval")
    expect(steps[2].type).toBe("commit_execution")
  })

  test("getStepsForWorkflow returns fixed steps for repo_analyze", () => {
    const steps = getStepsForWorkflow("repo_analyze")
    expect(steps).toHaveLength(3)
    expect(steps[0].type).toBe("collect_context")
    expect(steps[1].type).toBe("analyze_repository")
    expect(steps[2].type).toBe("publish_report")
  })

  test("getStepsForWorkflow returns fixed steps for review_and_signoff", () => {
    const steps = getStepsForWorkflow("review_and_signoff")
    expect(steps).toHaveLength(4)
    expect(steps[0].type).toBe("collect_context")
    expect(steps[1].type).toBe("produce_review")
    expect(steps[2].type).toBe("request_signoff")
    expect(steps[3].type).toBe("finalize_outcome")
  })

  test("getStepsForWorkflow returns empty for other workflows", () => {
    expect(getStepsForWorkflow("generic")).toHaveLength(0)
  })

  test("FIXED_STEPS contains correct steps in order", () => {
    expect(FIXED_STEPS).toHaveLength(3)
    expect(FIXED_STEPS[0].stepId).toBe("prepare_draft")
    expect(FIXED_STEPS[0].required).toBe(true)
    expect(FIXED_STEPS[1].stepId).toBe("request_approval")
    expect(FIXED_STEPS[2].stepId).toBe("commit_execution")
  })
})

describe("Workflow Registry", () => {
  test("isWorkflowAvailable for draft_and_approve", () => {
    expect(isWorkflowAvailable("draft_and_approve")).toBe(true)
  })

  test("isWorkflowAvailable for repo_analyze", () => {
    expect(isWorkflowAvailable("repo_analyze")).toBe(true)
  })

  test("isWorkflowAvailable for review_and_signoff", () => {
    expect(isWorkflowAvailable("review_and_signoff")).toBe(true)
  })

  test("isWorkflowAvailable for unsupported workflows", () => {
    expect(isWorkflowAvailable("generic")).toBe(false)
  })

  test("listAvailableWorkflows returns all three fixed workflows", () => {
    const workflows = listAvailableWorkflows()
    expect(workflows).toHaveLength(3)
    expect(workflows).toContain("draft_and_approve")
    expect(workflows).toContain("repo_analyze")
    expect(workflows).toContain("review_and_signoff")
  })

  test("WorkflowRegistry.get returns constructor for draft_and_approve", () => {
    const constructor = WorkflowRegistry.get("draft_and_approve")
    expect(constructor).not.toBeNull()
  })

  test("WorkflowRegistry.get returns constructor for repo_analyze", () => {
    const constructor = WorkflowRegistry.get("repo_analyze")
    expect(constructor).not.toBeNull()
  })

  test("WorkflowRegistry.get returns constructor for review_and_signoff", () => {
    const constructor = WorkflowRegistry.get("review_and_signoff")
    expect(constructor).not.toBeNull()
  })

  test("WorkflowRegistry.get returns null for unsupported workflows", () => {
    expect(WorkflowRegistry.get("generic")).toBeNull()
  })

  test("WorkflowRegistry.isAvailable works correctly", () => {
    expect(WorkflowRegistry.isAvailable("draft_and_approve")).toBe(true)
    expect(WorkflowRegistry.isAvailable("repo_analyze")).toBe(true)
    expect(WorkflowRegistry.isAvailable("review_and_signoff")).toBe(true)
    expect(WorkflowRegistry.isAvailable("generic")).toBe(false)
  })
})

describe("Workflow Execution Flow", () => {
  test("workflow follows fixed step sequence", () => {
    const steps = FIXED_STEPS
    expect(steps[0].type).toBe("prepare_draft")
    expect(steps[1].type).toBe("request_approval")
    expect(steps[2].type).toBe("commit_execution")
  })

  test("all fixed steps are required", () => {
    for (const step of FIXED_STEPS) {
      expect(step.required).toBe(true)
    }
  })

  test("workflow step titles are descriptive", () => {
    expect(FIXED_STEPS[0].title.length).toBeGreaterThan(0)
    expect(FIXED_STEPS[1].title.length).toBeGreaterThan(0)
    expect(FIXED_STEPS[2].title.length).toBeGreaterThan(0)
  })
})

import { describe, test, expect, beforeEach } from "bun:test"
import { isFixedWorkflow, getStepsForWorkflow, FIXED_STEPS } from "../../src/workflows/types"
import { WorkflowRegistry, isWorkflowAvailable, listAvailableWorkflows } from "../../src/workflows/registry"

describe("Workflow Types", () => {
  test("isFixedWorkflow returns true for draft_and_approve", () => {
    expect(isFixedWorkflow("draft_and_approve")).toBe(true)
  })

  test("isFixedWorkflow returns false for other workflows", () => {
    expect(isFixedWorkflow("generic")).toBe(false)
    expect(isFixedWorkflow("repo_analyze")).toBe(false)
    expect(isFixedWorkflow("review_and_signoff")).toBe(false)
  })

  test("getStepsForWorkflow returns fixed steps for draft_and_approve", () => {
    const steps = getStepsForWorkflow("draft_and_approve")
    expect(steps).toHaveLength(3)
    expect(steps[0].type).toBe("prepare_draft")
    expect(steps[1].type).toBe("request_approval")
    expect(steps[2].type).toBe("commit_execution")
  })

  test("getStepsForWorkflow returns empty for other workflows", () => {
    expect(getStepsForWorkflow("generic")).toHaveLength(0)
    expect(getStepsForWorkflow("repo_analyze")).toHaveLength(0)
    expect(getStepsForWorkflow("review_and_signoff")).toHaveLength(0)
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

  test("isWorkflowAvailable for unsupported workflows", () => {
    expect(isWorkflowAvailable("generic")).toBe(false)
    expect(isWorkflowAvailable("repo_analyze")).toBe(false)
    expect(isWorkflowAvailable("review_and_signoff")).toBe(false)
  })

  test("listAvailableWorkflows returns only draft_and_approve", () => {
    const workflows = listAvailableWorkflows()
    expect(workflows).toHaveLength(1)
    expect(workflows[0]).toBe("draft_and_approve")
  })

  test("WorkflowRegistry.get returns constructor for draft_and_approve", () => {
    const constructor = WorkflowRegistry.get("draft_and_approve")
    expect(constructor).not.toBeNull()
  })

  test("WorkflowRegistry.get returns null for unsupported workflows", () => {
    expect(WorkflowRegistry.get("generic")).toBeNull()
    expect(WorkflowRegistry.get("repo_analyze")).toBeNull()
    expect(WorkflowRegistry.get("review_and_signoff")).toBeNull()
  })

  test("WorkflowRegistry.isAvailable works correctly", () => {
    expect(WorkflowRegistry.isAvailable("draft_and_approve")).toBe(true)
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

import { describe, it, expect } from "bun:test"
import { Bus } from "./index"
import { Lifecycle } from "./lifecycle"
import { bootstrap } from "@/cli/bootstrap"
import path from "path"

describe("Lifecycle Events", () => {
  const repoRoot = path.resolve(import.meta.dir, "../../../..")

  it("should publish and subscribe to intent.created", async () => {
    await bootstrap(repoRoot, async () => {
      let captured: any = null
      Bus.subscribe(Lifecycle.IntentCreated, (event) => {
        captured = event
      })

      const payload = {
        runId: "sess_123",
        intentType: "code_change",
        goal: "Fix the bug",
        riskLevel: "low" as const,
        confidence: 0.9,
      }

      await Bus.publish(Lifecycle.IntentCreated, payload)

      expect(captured).not.toBeNull()
      expect(captured.type).toBe("intent.created")
      expect(captured.properties.runId).toBe("sess_123")
      expect(captured.properties.goal).toBe("Fix the bug")
    })
  })

  it("should publish and subscribe to plan.compiled", async () => {
    await bootstrap(repoRoot, async () => {
      let captured: any = null
      Bus.subscribe(Lifecycle.PlanCompiled, (event) => {
        captured = event
      })

      const payload = {
        runId: "sess_456",
        planId: "plan_abc",
        tasks: [
          { id: "task_1", name: "Task 1", description: "Desc 1", dependencies: [] }
        ],
      }

      await Bus.publish(Lifecycle.PlanCompiled, payload)

      expect(captured).not.toBeNull()
      expect(captured.properties.planId).toBe("plan_abc")
      expect(captured.properties.tasks[0].id).toBe("task_1")
    })
  })

  it("should publish and subscribe to artifact.created", async () => {
    await bootstrap(repoRoot, async () => {
      let captured: any = null
      Bus.subscribe(Lifecycle.ArtifactCreated, (event) => {
        captured = event
      })

      const payload = {
        runId: "sess_789",
        artifact: {
          artifactId: "art_1",
          runId: "sess_789",
          type: "report" as const,
          title: "Test Report",
          createdAt: new Date().toISOString(),
        },
      }

      await Bus.publish(Lifecycle.ArtifactCreated, payload)

      expect(captured).not.toBeNull()
      expect(captured.properties.artifact.artifactId).toBe("art_1")
      expect(captured.properties.artifact.type).toBe("report")
    })
  })
})

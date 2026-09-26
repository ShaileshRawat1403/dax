import { describe, expect, it } from "bun:test"
import { shouldRenderSessionText } from "./session-text"
import { buildStreamItems } from "@/dax/presentation/session-stream"
import type { ProjectedRun } from "@/server/run-contract"

describe("TextPart reply visibility", () => {
  it("does not hide text by agent name in the actual renderer", async () => {
    const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text()
    const textPart = source.slice(source.indexOf("function TextPart("), source.indexOf("function toolDisplayName("))
    expect(source.includes("SUB_TASK_AGENTS_UI")).toBe(false)
    expect(textPart.includes("isSubTaskAgent")).toBe(false)
    expect(textPart).toContain("<Show when={shouldRenderSessionText(props.part)}>")
  })

  it("renders nonempty primary Explore text through the actual TextPart condition", () => {
    const items = buildStreamItems(run(), [assistant("primary", "explore")], parts(), "primary")
    expect(renderedTexts(items)).toEqual(["Explore reply"])
    expect(shouldRenderSessionText({ text: " \n " })).toBe(false)
  })

  it("separates delegated child output in the parent and renders it when the child is opened", () => {
    const messages = [assistant("primary", "build"), assistant("child", "explore")]
    const textParts = {
      ...parts(),
      "answer-primary": [{ id: "parent-text", type: "text" as const, text: "Parent reply", sessionID: "primary", messageID: "answer-primary" }],
    }
    expect(renderedTexts(buildStreamItems(run(), messages, textParts, "primary"))).toEqual(["Parent reply"])
    expect(renderedTexts(buildStreamItems(run(), messages, textParts, "child"))).toEqual(["Explore reply"])
  })
})

function assistant(sessionID: string, agent: string) {
  return { id: `answer-${sessionID}`, sessionID, role: "assistant", agent, time: { created: 1000, completed: 1100 } }
}

function parts() {
  return Object.fromEntries(["primary", "child"].map((sessionID) => [
    `answer-${sessionID}`,
    [{ id: `text-${sessionID}`, type: "text" as const, text: "Explore reply", sessionID, messageID: `answer-${sessionID}` }],
  ]))
}

function renderedTexts(items: ReturnType<typeof buildStreamItems>) {
  return items.filter((item) => item.kind === "message.assistant").flatMap((item) =>
    (item.parts ?? []).flatMap((part) => part.type === "text" && shouldRenderSessionText(part) ? [part.text] : []),
  )
}

function run(): ProjectedRun {
  return {
    header: { runId: "test-run", title: "Test", status: "running", createdAt: "2026-09-26T00:00:00Z", updatedAt: "2026-09-26T00:00:00Z" },
    summary: undefined, narrative: [], approvals: [], artifacts: [], interventions: [], proposedChanges: [],
  }
}

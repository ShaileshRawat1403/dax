import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { PM } from "../../src/pm"
import { PMNoteTool } from "../../src/tool/pm_note"

describe("pm_note tool", () => {
  test("saves a dsr row in local pm db", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PMNoteTool.init()
        let asked = false
        const result = await tool.execute(
          {
            title: "Daily update",
            note: "Implemented local PM note save and validated persistence.",
            tags: ["dsr", "pm", "feature"],
          },
          {
            sessionID: "ses_test_pm",
            messageID: "msg_test_pm",
            callID: "call_test_pm",
            agent: "build",
            abort: AbortSignal.any([]),
            messages: [],
            metadata: () => {},
            ask: async () => {
              asked = true
            },
          },
        )

        const rows = await PM.list_dsr({
          project_id: Instance.project.id,
          limit: 10,
        })

        expect(asked).toBeTrue()
        expect(result.output).toContain("Saved DSR note")
        expect(rows.length).toBeGreaterThan(0)
        expect(rows[0]?.title).toBe("Daily update")
        expect(rows[0]?.session_id).toBe("ses_test_pm")
        expect(rows[0]?.source).toBe("agent")
      },
    })
  })
})

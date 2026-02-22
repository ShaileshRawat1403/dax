import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { PM } from "../../src/pm"

function lastText(parts: { type: string; text?: string }[]) {
  return parts.findLast((x) => x.type === "text" && x.text)?.text ?? ""
}

describe("pm slash command", () => {
  test("/pm note saves and /pm list returns entries", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const note = await SessionPrompt.command({
          sessionID: session.id,
          command: "pm",
          arguments: "note Daily update | Finished PM backend wiring | pm,dsr",
        })
        expect(lastText(note.parts as { type: string; text?: string }[])).toContain("Saved DSR note")

        const list = await SessionPrompt.command({
          sessionID: session.id,
          command: "pm",
          arguments: "list",
        })
        const listText = lastText(list.parts as { type: string; text?: string }[])
        expect(listText).toContain("Daily update")
        expect(listText).toContain("[pm, dsr]")
      },
    })
  })

  test("/pm rules add writes a constraint", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const add = await SessionPrompt.command({
          sessionID: session.id,
          command: "pm",
          arguments: "rules add require_approval migrations/** ask",
        })
        expect(lastText(add.parts as { type: string; text?: string }[])).toContain("Rule added")

        const rules = await PM.list_constraints({
          project_id: Instance.project.id,
          limit: 20,
        })
        expect(rules.some((x) => x.rule_type === "require_approval" && x.pattern === "migrations/**")).toBeTrue()
      },
    })
  })
})

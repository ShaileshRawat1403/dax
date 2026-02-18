import z from "zod"
import { Tool } from "./tool"
import { PM } from "@/pm"
import { Instance } from "@/project/instance"
import DESCRIPTION from "./pm_note.txt"

export const PMNoteTool = Tool.define("pm_note", {
  description: DESCRIPTION,
  parameters: z.object({
    title: z.string().describe("Short DSR title"),
    note: z.string().describe("Daily status note content"),
    tags: z.array(z.string()).describe("Tags like bug, feature, blocker").optional(),
    day: z.string().describe("Day in YYYY-MM-DD format").optional(),
    author: z.string().describe("Optional author display name").optional(),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "pm_note",
      patterns: ["dsr"],
      always: ["*"],
      metadata: {
        title: params.title,
        day: params.day,
        tags: params.tags ?? [],
      },
    })

    const row = await PM.save_dsr({
      project_id: Instance.project.id,
      session_id: ctx.sessionID,
      source: "agent",
      title: params.title,
      note: params.note,
      day: params.day,
      tags: params.tags,
      author: params.author,
    })

    return {
      title: params.title,
      metadata: {
        id: row.id,
        day: row.day,
      },
      output: `Saved DSR note to local PM DB.\nid: ${row.id}\nday: ${row.day}`,
    }
  },
})

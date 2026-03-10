import { describe, expect, test } from "bun:test"
import { buildArtifactsForSession, formatArtifactTable, type ArtifactRow } from "./artifacts"
import type { Session } from "../../session"
import type { MessageV2 } from "../../session/message-v2"
import { tmpdir } from "os"
import path from "path"

describe("artifacts command helpers", () => {
  test("formats empty artifact state for operators", () => {
    expect(formatArtifactTable([])).toBe("No retained artifacts.")
  })

  test("normalizes mixed artifact sources from canonical runtime data", () => {
    const session = {
      id: "session_123",
      parentID: undefined,
      slug: "governance-review",
      projectID: "project_123",
      directory: "/repo",
      title: "Governance review",
      version: "test",
      time: { created: 1_700_000_000_000, updated: 1_700_000_100_000 },
      summary: { additions: 4, deletions: 2, files: 1 },
    } as Session.Info

    const messages = [
      {
        info: {
          id: "message_123",
          sessionID: "session_123",
          role: "assistant",
        },
        parts: [
          {
            id: "part_123",
            messageID: "message_123",
            sessionID: "session_123",
            type: "tool",
            callID: "call_123",
            tool: "write",
            state: {
              status: "completed",
              input: {},
              output: "done",
              title: "Write release notes",
              metadata: {
                outputPath: "/Users/Shared/MYAIAGENTS/dax/.tmp/tool-output.log",
              },
              time: {
                start: 1_700_000_000_100,
                end: 1_700_000_000_200,
              },
              attachments: [
                {
                  id: "file_123",
                  messageID: "message_123",
                  sessionID: "session_123",
                  type: "file",
                  mime: "text/markdown",
                  filename: "release-notes.md",
                  url: "file:///tmp/release-notes.md",
                },
              ],
            },
          },
        ],
      },
    ] as unknown as MessageV2.WithParts[]

    const rows = buildArtifactsForSession(session, messages, [
      {
        file: "README.md",
        additions: 4,
        deletions: 2,
      },
    ] as any)

    expect(rows.map((row) => row.kind)).toEqual(["session_diff", "attachment", "truncated_output"])
    expect(rows[0]?.session_id).toBe("session_123")
    expect(rows[1]?.label).toBe("release-notes.md")
    expect(rows[2]?.reference).toBe("../../.tmp/tool-output.log")
  })

  test("formats readable artifact entries", () => {
    const rendered = formatArtifactTable([
      {
        id: "artifact_123",
        kind: "attachment",
        session_id: "session_123",
        label: "release-notes.md",
        source: "write attachment",
        created_at: 1_700_000_000_000,
        reference: "release-notes.md",
      } satisfies ArtifactRow,
    ])

    expect(rendered).toContain("Artifact ID: artifact_123")
    expect(rendered).toContain("Kind: Attachment")
    expect(rendered).toContain("Related session: session_123")
    expect(rendered).toContain("Reference: release-notes.md")
  })

  test("indexes durable write outputs inside the session workspace as retained artifacts", async () => {
    const directory = path.join(tmpdir(), `dax-artifacts-${Date.now()}`)
    const filepath = path.join(directory, "artifacts", "write-output.txt")
    await Bun.write(filepath, "ok")

    const session = {
      id: "session_write",
      parentID: undefined,
      slug: "write-eval",
      projectID: "project_write",
      directory,
      title: "Write eval",
      version: "test",
      time: { created: 1_700_000_000_000, updated: 1_700_000_100_000 },
      summary: { additions: 0, deletions: 0, files: 0 },
    } as Session.Info

    const messages = [
      {
        info: {
          id: "message_write",
          sessionID: "session_write",
          role: "assistant",
        },
        parts: [
          {
            id: "part_write",
            messageID: "message_write",
            sessionID: "session_write",
            type: "tool",
            callID: "call_write",
            tool: "write",
            state: {
              status: "completed",
              input: {},
              output: "done",
              title: filepath,
              metadata: {
                filepath,
                exists: false,
                diagnostics: {},
              },
              time: {
                start: 1_700_000_000_100,
                end: 1_700_000_000_200,
              },
            },
          },
        ],
      },
    ] as unknown as MessageV2.WithParts[]

    const rows = buildArtifactsForSession(session, messages, [] as any)

    expect(rows.map((row) => row.kind)).toEqual(["workspace_file"])
    expect(rows[0]?.label).toBe("write-output.txt")
    expect(rows[0]?.reference).toBe(path.join("artifacts", "write-output.txt"))
  })
})

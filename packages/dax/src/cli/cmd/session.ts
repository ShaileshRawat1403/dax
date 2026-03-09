import type { Argv } from "yargs"
import * as prompts from "@clack/prompts"
import { cmd } from "./cmd"
import { Session } from "../../session"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { Locale } from "../../util/locale"
import { Flag } from "../../flag/flag"
import { EOL } from "os"
import path from "path"

function pagerCmd(): string[] {
  const lessOptions = ["-R", "-S"]
  if (process.platform !== "win32") {
    return ["less", ...lessOptions]
  }

  // user could have less installed via other options
  const lessOnPath = Bun.which("less")
  if (lessOnPath) {
    if (Bun.file(lessOnPath).size) return [lessOnPath, ...lessOptions]
  }

  if (Flag.DAX_GIT_BASH_PATH) {
    const less = path.join(Flag.DAX_GIT_BASH_PATH, "..", "..", "usr", "bin", "less.exe")
    if (Bun.file(less).size) return [less, ...lessOptions]
  }

  const git = Bun.which("git")
  if (git) {
    const less = path.join(git, "..", "..", "usr", "bin", "less.exe")
    if (Bun.file(less).size) return [less, ...lessOptions]
  }

  // Fall back to Windows built-in more (via cmd.exe)
  return ["cmd", "/c", "more"]
}

type SessionSummary = {
  id: string
  title: string
  updated: number
  created: number
  projectId: string
  directory: string
}

export const SessionCommand = cmd({
  command: "session",
  describe: "manage sessions",
  builder: (yargs: Argv) => yargs.command(SessionListCommand).command(SessionPruneCommand).demandCommand(),
  async handler() {},
})

export const SessionListCommand = cmd({
  command: "list",
  describe: "list sessions",
  builder: (yargs: Argv) => {
    return yargs
      .option("max-count", {
        alias: "n",
        describe: "limit to N most recent sessions",
        type: "number",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessions = []
      for await (const session of Session.list()) {
        if (!session.parentID) {
          sessions.push(session)
        }
      }

      sessions.sort((a, b) => b.time.updated - a.time.updated)

      const limitedSessions = args.maxCount ? sessions.slice(0, args.maxCount) : sessions

      if (limitedSessions.length === 0) {
        return
      }

      let output: string
      if (args.format === "json") {
        output = formatSessionJSON(limitedSessions)
      } else {
        output = formatSessionTable(limitedSessions)
      }

      const shouldPaginate = process.stdout.isTTY && !args.maxCount && args.format === "table"

      if (shouldPaginate) {
        const proc = Bun.spawn({
          cmd: pagerCmd(),
          stdin: "pipe",
          stdout: "inherit",
          stderr: "inherit",
        })

        proc.stdin.write(output)
        proc.stdin.end()
        await proc.exited
      } else {
        console.log(output)
      }
    })
  },
})

function formatSessionTable(sessions: Session.Info[]): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))

  const header = `Session ID${" ".repeat(maxIdWidth - 10)}  Title${" ".repeat(maxTitleWidth - 5)}  Updated`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    const line = `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${timeStr}`
    lines.push(line)
  }

  return lines.join(EOL)
}

function formatSessionJSON(sessions: Session.Info[]): string {
  const jsonData = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    updated: session.time.updated,
    created: session.time.created,
    projectId: session.projectID,
    directory: session.directory,
  }))
  return JSON.stringify(jsonData, null, 2)
}

export const SessionPruneCommand = cmd({
  command: "prune",
  describe: "delete older sessions while keeping the most recent ones",
  builder: (yargs: Argv) =>
    yargs
      .option("keep", {
        alias: "k",
        describe: "keep N most recent top-level sessions",
        type: "number",
        default: 20,
      })
      .option("dry-run", {
        describe: "show what would be deleted without deleting",
        type: "boolean",
        default: false,
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
      .option("yes", {
        alias: "y",
        describe: "skip confirmation prompt",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const keep = Math.max(0, Math.floor(args.keep ?? 20))
      const sessions: Session.Info[] = []
      for await (const session of Session.list()) {
        if (!session.parentID) sessions.push(session)
      }
      sessions.sort((a, b) => b.time.updated - a.time.updated)

      const keepSessions = sessions.slice(0, keep)
      const pruneSessions = sessions.slice(keep)

      const summary = {
        projectId: keepSessions[0]?.projectID ?? pruneSessions[0]?.projectID ?? "",
        total: sessions.length,
        keep,
        kept: keepSessions.length,
        prune: pruneSessions.length,
        sessions: pruneSessions.map(toSessionSummary),
      }

      if (args.format === "json") {
        console.log(JSON.stringify(summary, null, 2))
      } else {
        renderPruneSummary(summary)
      }

      if (pruneSessions.length === 0) {
        if (args.format !== "json") prompts.outro("No sessions need pruning")
        return
      }

      if (args.dryRun) {
        if (args.format !== "json") prompts.outro("Dry run only; no sessions deleted")
        return
      }

      if (!args.yes) {
        const confirm = await prompts.confirm({
          message: `Delete ${pruneSessions.length} older sessions and keep ${keepSessions.length}?`,
          initialValue: false,
        })
        if (!confirm || prompts.isCancel(confirm)) {
          prompts.outro("Cancelled")
          return
        }
      }

      const spinner = prompts.spinner()
      spinner.start(`Deleting ${pruneSessions.length} older sessions...`)
      for (const session of pruneSessions) {
        await Session.remove(session.id)
      }
      spinner.stop(`Deleted ${pruneSessions.length} sessions`)
      prompts.outro(`Kept ${keepSessions.length} recent sessions`)
    })
  },
})

function toSessionSummary(session: Session.Info): SessionSummary {
  return {
    id: session.id,
    title: session.title,
    updated: session.time.updated,
    created: session.time.created,
    projectId: session.projectID,
    directory: session.directory,
  }
}

function renderPruneSummary(input: {
  total: number
  keep: number
  kept: number
  prune: number
  sessions: SessionSummary[]
}) {
  UI.empty()
  prompts.intro("Session prune")
  prompts.log.info(`Total sessions: ${input.total}`)
  prompts.log.info(`Keeping newest: ${input.kept}`)
  prompts.log.info(`Deleting older: ${input.prune}`)
  if (input.prune === 0) return
  prompts.log.message("Oldest sessions queued for deletion:")
  for (const session of input.sessions.slice(0, 10)) {
    prompts.log.info(`  • ${session.title} ${UI.Style.TEXT_DIM}(${Locale.todayTimeOrDateTime(session.updated)})`)
  }
  if (input.sessions.length > 10) {
    prompts.log.info(`  … and ${input.sessions.length - 10} more`)
  }
}

import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { collectSessionVerification, formatSessionVerification } from "@/governance"
import { readReplayEventsFile, verifyReplayEvents, formatReplayProof } from "@/verify/replay"
import { DaxCoreError } from "@/rust/core"
import { Instance } from "@/project/instance"
import { PM } from "@/pm"
import { EOL } from "os"

/**
 * Recompute the RAO audit chain for this project.
 *
 * The trail `dax audit` prints is what receipts cite, and until it was chained
 * a single UPDATE against the SQLite file left doctored history reading clean.
 */
async function handleAuditVerification(format: string | undefined): Promise<void> {
  await bootstrap(process.cwd(), async () => {
    const result = await PM.verify_events({ project_id: Instance.project.id })

    if (format === "json") {
      console.log(JSON.stringify(result, null, 2))
      if (!result.ok) process.exitCode = 1
      return
    }

    process.stdout.write(`Audit trail for ${Instance.project.id}${EOL}${EOL}`)
    process.stdout.write(`  events    ${result.total}${EOL}`)
    process.stdout.write(`  chained   ${result.chained}${EOL}`)
    if (result.unchained > 0) process.stdout.write(`  unchained ${result.unchained}${EOL}`)
    process.stdout.write(EOL)

    if (!result.ok) {
      process.stdout.write(`FAILED at sequence ${result.failure?.seq}: ${result.failure?.reason}${EOL}`)
      process.stdout.write(`The audit trail has been altered after it was written.${EOL}`)
      process.exitCode = 1
      return
    }

    process.stdout.write(`Chain intact: every chained event still hashes to what was recorded.${EOL}`)
    if (result.unchained > 0) {
      process.stdout.write(EOL)
      process.stdout.write(`${result.unchained} event(s) predate hash chaining and cannot be verified.${EOL}`)
      process.stdout.write(`They are reported rather than back-filled: inventing chain history for${EOL}`)
      process.stdout.write(`records that were never chained would forge the trail this command checks.${EOL}`)
    }
  })
}

async function handleReplayVerification(args: {
  events?: string
  format?: string
  state?: boolean
}): Promise<void> {
  const eventsPath = args.events
  if (!eventsPath) {
    throw new Error("Missing required option: --events <path>")
  }

  const events = await readReplayEventsFile(eventsPath)
  const includeState = args.state === true && args.format === "json"
  const result = await verifyReplayEvents(events, { includeState })

  if (args.format === "json") {
    if (result.includeState) {
      console.log(JSON.stringify({ proof: result.proof, state: result.state }, null, 2))
    } else {
      console.log(JSON.stringify(result.proof, null, 2))
    }
    return
  }

  console.log(formatReplayProof(result.proof))
}

export const VerifyCommand = cmd({
  command: "verify <session-id>",
  describe: "verify a DAX session or replay a DAX event log",
  builder: (yargs: Argv) =>
    yargs
      .positional("session-id", {
        describe: "session id to verify, 'audit' to verify this project's audit chain, or 'replay' to verify a DAX event log",
        type: "string",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
      .option("events", {
        describe: "path to DAX event log JSON file (used with `verify replay`)",
        type: "string",
      })
      .option("state", {
        describe: "include replayed final RunState in JSON output (used with `verify replay --format json`)",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    const sessionID = String(args["session-id"])

    if (sessionID === "audit") {
      await handleAuditVerification(args.format)
      return
    }

    if (sessionID === "replay") {
      try {
        await handleReplayVerification({
          events: args.events,
          format: args.format,
          state: args.state,
        })
      } catch (err) {
        if (err instanceof DaxCoreError) {
          process.stderr.write(`Replay verification failed: ${err.stderr.trim() || err.message}\n`)
        } else {
          process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
        }
        process.exit(1)
      }
      return
    }

    await bootstrap(process.cwd(), async () => {
      const summary = await collectSessionVerification(sessionID)

      if (args.format === "json") {
        console.log(JSON.stringify(summary, null, 2))
        return
      }

      console.log(formatSessionVerification(summary))
    })
  },
})

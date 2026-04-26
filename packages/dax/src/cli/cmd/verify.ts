import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { collectSessionVerification, formatSessionVerification } from "@/governance"
import { readReplayEventsFile, verifyReplayEvents, formatReplayProof } from "@/verify/replay"
import { DaxCoreError } from "@/rust/core"

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
        describe: "session id to verify, or 'replay' to verify a DAX event log",
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

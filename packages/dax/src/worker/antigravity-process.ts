import { spawn } from "node:child_process"
import type { Writable } from "node:stream"
import { Shell } from "@/shell/shell"
import { processGroupAlive } from "./worker-sandbox"
import {
  AntigravityDecoder,
  AntigravityProtocol,
  AntigravityStop,
  antigravityUserMessage,
  type AntigravityStreamRecord,
  type AntigravityStreamResult,
} from "./antigravity-stream"

// fd 3 is an ownership pipe. Only DAX holds its writing end. On parent death,
// the watcher receives EOF and kills this group even if AGY ignores stdin EOF.
// The watcher ignores TERM so it survives long enough to escalate to KILL.
// `kill -s SIG --` is the POSIX form: dash, /bin/sh on Debian and Ubuntu,
// reads `kill -TERM --` as an illegal pid and would never reap the group.
export const OWNER_WATCH = `group=$$
(trap '' TERM INT; while IFS= read -r lease <&3; do :; done
 kill -s TERM -- "-$group" 2>/dev/null
 sleep 0.2
 kill -s KILL -- "-$group" 2>/dev/null) &
exec "$@" 3<&-`

export function startAntigravityProcess(input: {
  command: string[]
  cwd: string
  model: string
  env: Record<string, string>
  /** Bounds the whole attempt, including time spent waiting for the operator. */
  timeoutMs: number
  onRecord: (record: AntigravityStreamRecord) => Promise<void>
}) {
  if (process.platform === "win32") throw new Error("AGY governed conversations require macOS or Linux isolation.")
  const proc = spawn("/bin/sh", ["-c", OWNER_WATCH, "dax-agy-owner", ...input.command], {
    cwd: input.cwd,
    env: input.env,
    detached: true,
    stdio: ["pipe", "pipe", "pipe", "pipe"],
  })
  const owner = proc.stdio[3] as Writable
  const decoder = new AntigravityDecoder()
  const protocol = new AntigravityProtocol(input)
  let closing = false
  let failure: Error | undefined
  let stderr = ""
  let lastResult: AntigravityStreamResult | undefined
  let active: { resolve: (value: AntigravityStreamResult) => void; reject: (error: Error) => void } | undefined
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined
  let killing: Promise<void> | undefined
  const kill = () => (killing ??= Shell.killTree(proc, { exited: () => !proc.pid || !processGroupAlive(proc.pid) }))
  const fail = (error: unknown) => {
    failure ??= error instanceof Error ? error : new Error(String(error))
    closing = true
    active?.reject(failure)
    active = undefined
    void kill().catch(() => {})
  }
  // No idle timer: between turns AGY waits for a human operator. The execution
  // contract timeout is the only declared bound on the attempt.
  const deadline = setTimeout(() => fail(new Error(AntigravityStop.deadline)), input.timeoutMs)
  const startup = setTimeout(
    () => fail(new Error(AntigravityStop.initialization)),
    Math.min(input.timeoutMs, 30_000),
  )
  proc.stdin!.on("error", fail)
  owner.on("error", fail)
  const exited = new Promise<number>((resolve, reject) => {
    proc.once("error", reject)
    proc.once("exit", (code) => resolve(code ?? -1))
  })
  const diagnostics = (async () => {
    for await (const chunk of proc.stderr!) {
      if (stderr.length < 20_000) stderr += chunk.toString().slice(0, 20_000 - stderr.length)
    }
  })()
  const reader = (async () => {
    try {
      for await (const chunk of proc.stdout!) {
        for (const record of decoder.push(chunk)) {
          protocol.accept(record)
          if (record.event === "init") clearTimeout(startup)
          // A DAX-side failure to present a record is not an AGY protocol failure.
          const unpresented = await input.onRecord(record).then(
            () => undefined,
            (error: unknown) => error ?? new Error("DAX could not record an AGY observation."),
          )
          if (unpresented) return fail(unpresented)
          if (record.event === "result") {
            lastResult = record.result
            const turn = active
            active = undefined
            turn?.resolve(record.result)
          }
        }
      }
      // End of output normally accompanies exit. Let a prompt exit name the stop
      // reason before validating that every submitted turn received its result.
      await Promise.race([exited.catch(() => {}), Bun.sleep(1_000)])
      decoder.end()
      protocol.end()
    } catch (error) {
      fail(
        new Error(`${AntigravityStop.protocol}: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        }),
      )
    }
  })()
  const done = (async () => {
    try {
      const exitCode = await exited
      if (!closing) fail(new Error(`${AntigravityStop.exit} (${exitCode}).`))
      await kill()
      await Promise.all([reader, diagnostics])
      if (proc.pid && processGroupAlive(proc.pid))
        throw new Error("AGY process ownership cleanup could not be confirmed.")
      if (failure) throw new Error(`${failure.message}${stderr.trim() ? `\n${stderr.trim()}` : ""}`)
      if (exitCode !== 0 || !lastResult) throw new Error(`AGY process failed (${exitCode}). ${stderr}`)
      return { exitCode, stdout: JSON.stringify(lastResult), stderr, reapedDescendants: true }
    } finally {
      clearTimeout(deadline)
      clearTimeout(startup)
      if (shutdownTimer) clearTimeout(shutdownTimer)
      await kill()
      owner.destroy()
    }
  })()
  // The workflow awaits done; suppress unhandled rejection while a turn is being presented.
  void done.catch(() => {})

  return {
    done,
    async send(text: string): Promise<AntigravityStreamResult> {
      const line = antigravityUserMessage(text)
      if (closing || failure) throw failure ?? new Error("AGY conversation is closed.")
      if (active) throw new Error("Wait for the current AGY response before sending another message.")
      protocol.beginTurn()
      return new Promise((resolve, reject) => {
        active = { resolve, reject }
        proc.stdin!.write(line, (error) => {
          if (error) fail(error)
        })
      })
    },
    finish() {
      if (active) throw new Error("Wait for the AGY response before finishing for review.")
      if (closing) throw failure ?? new Error("AGY conversation is already closed.")
      closing = true
      proc.stdin!.end()
      shutdownTimer = setTimeout(
        () => fail(new Error(`${AntigravityStop.protocol}: AGY did not shut down after stdin closed.`)),
        30_000,
      )
    },
    /** DAX-initiated stop. The reason becomes the recorded failure unless AGY already failed. */
    cancel(reason: string = AntigravityStop.operator) {
      fail(new Error(reason))
    },
  }
}

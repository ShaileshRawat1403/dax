import { spawn } from "node:child_process"
import type { Writable } from "node:stream"
import { Shell } from "@/shell/shell"
import { processGroupAlive } from "./worker-sandbox"
import {
  AntigravityDecoder,
  AntigravityProtocol,
  antigravityUserMessage,
  type AntigravityStreamRecord,
  type AntigravityStreamResult,
} from "./antigravity-stream"

// fd 3 is an ownership pipe. Only DAX holds its writing end. On parent death,
// the watcher receives EOF and kills this group even if AGY ignores stdin EOF.
// The watcher ignores TERM so it survives long enough to escalate to KILL.
const OWNER_WATCH = `group=$$
(trap '' TERM INT; while IFS= read -r lease <&3; do :; done
 kill -TERM -- "-$group" 2>/dev/null
 sleep 0.2
 kill -KILL -- "-$group" 2>/dev/null) &
exec "$@" 3<&-`

export function startAntigravityProcess(input: {
  command: string[]
  cwd: string
  model: string
  env: Record<string, string>
  timeoutMs: number
  idleTimeoutMs?: number
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
  let idleTimer: ReturnType<typeof setTimeout> | undefined
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
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    if (!closing)
      idleTimer = setTimeout(() => fail(new Error("AGY conversation idle timeout.")), input.idleTimeoutMs ?? 300_000)
  }
  const deadline = setTimeout(() => fail(new Error("AGY governed attempt timed out.")), input.timeoutMs)
  const startup = setTimeout(() => fail(new Error("AGY initialization timed out.")), Math.min(input.timeoutMs, 30_000))
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
          await input.onRecord(record)
          if (record.event === "result") {
            lastResult = record.result
            const turn = active
            active = undefined
            turn?.resolve(record.result)
            resetIdle()
          }
        }
      }
      decoder.end()
      protocol.end()
    } catch (error) {
      fail(error)
    }
  })()
  const done = (async () => {
    try {
      const exitCode = await exited
      if (!closing) fail(new Error(`AGY process exited unexpectedly (${exitCode}).`))
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
      if (idleTimer) clearTimeout(idleTimer)
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
      if (idleTimer) clearTimeout(idleTimer)
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
      if (idleTimer) clearTimeout(idleTimer)
      proc.stdin!.end()
      shutdownTimer = setTimeout(() => fail(new Error("AGY did not shut down after stdin closed.")), 30_000)
    },
    cancel() {
      fail(new Error("AGY attempt cancelled by the operator."))
    },
  }
}

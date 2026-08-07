import { Flag } from "@/flag/flag"
import { lazy } from "@/util/lazy"
import path from "path"
import { spawn } from "child_process"

const SIGKILL_TIMEOUT_MS = 200

export namespace Shell {
  /**
   * A spawned process DAX can signal.
   *
   * Structural on purpose: Node's `ChildProcess` and Bun's `Subprocess` both
   * satisfy it, so the shell tool and the governed worker sandbox share one
   * process-tree kill path instead of growing two that drift apart.
   */
  export type Killable = {
    pid?: number | undefined
    kill(signal?: number | NodeJS.Signals): unknown
  }

  /**
   * Terminate a process and everything it left behind.
   *
   * Assumes the caller spawned `proc` detached, so `proc.pid` is also the
   * process-group id. Escalates to SIGKILL on a fixed timer rather than
   * waiting on the process, because a child that ignores SIGTERM is exactly
   * the case where waiting never returns.
   */
  export async function killTree(proc: Killable, opts?: { exited?: () => boolean }): Promise<void> {
    const pid = proc.pid
    if (!pid || opts?.exited?.()) return

    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(pid), "/f", "/t"], { stdio: "ignore" })
        killer.once("exit", () => resolve())
        killer.once("error", () => resolve())
      })
      return
    }

    try {
      process.kill(-pid, "SIGTERM")
      await Bun.sleep(SIGKILL_TIMEOUT_MS)
      if (!opts?.exited?.()) {
        process.kill(-pid, "SIGKILL")
      }
    } catch (_e) {
      proc.kill("SIGTERM")
      await Bun.sleep(SIGKILL_TIMEOUT_MS)
      if (!opts?.exited?.()) {
        proc.kill("SIGKILL")
      }
    }
  }
  const BLACKLIST = new Set(["fish", "nu"])

  function fallback() {
    if (process.platform === "win32") {
      if (Flag.DAX_GIT_BASH_PATH) return Flag.DAX_GIT_BASH_PATH
      const git = Bun.which("git")
      if (git) {
        // git.exe is typically at: C:\Program Files\Git\cmd\git.exe
        // bash.exe is at: C:\Program Files\Git\bin\bash.exe
        const bash = path.join(git, "..", "..", "bin", "bash.exe")
        if (Bun.file(bash).size) return bash
      }
      return process.env.COMSPEC || "cmd.exe"
    }
    if (process.platform === "darwin") return "/bin/zsh"
    const bash = Bun.which("bash")
    if (bash) return bash
    return "/bin/sh"
  }

  export const preferred = lazy(() => {
    const s = process.env.SHELL
    if (s) return s
    return fallback()
  })

  export const acceptable = lazy(() => {
    const s = process.env.SHELL
    if (s && !BLACKLIST.has(process.platform === "win32" ? path.win32.basename(s) : path.basename(s))) return s
    return fallback()
  })
}

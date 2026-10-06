import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/** Compile actual SessionPrompt/factory/guardian modules; the fixture has no authority/provider spies. */
describe("stage 4d genuine compiled production authority", () => {
  test("native and remote-only root producers, barrier states, image changes and source refusals", async () => {
    const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "dax-stage4d-producer-")))
    const entry = path.resolve(import.meta.dir, "../../test/fixtures/grant-stage4d-producer.ts")
    const logDir = process.env.DAX_PRODUCER_LOG_DIR
    if (logDir) await fs.mkdir(logDir, { recursive: true })
    const env = {
      ...process.env,
      DAX_TEST_HOME: home,
      DAX_DISABLE_MODELS_FETCH: "1",
      DAX_DISABLE_CONFIG_AUTO_INSTALL: "1",
      DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS: "0",
      DAX_DISABLE_LSP: "1",
      DAX_DISABLE_FORMAT: "1",
      XDG_CONFIG_HOME: path.join(home, "xdg-config"),
      XDG_CACHE_HOME: path.join(home, "xdg-cache"),
      XDG_DATA_HOME: path.join(home, "xdg-data"),
      XDG_STATE_HOME: path.join(home, "xdg-state"),
    }
    const run = async (name: string, argv: string[]) => {
      const child = Bun.spawn(argv, {
        cwd: path.resolve(import.meta.dir, "../.."),
        env,
        stdout: "pipe",
        stderr: "pipe",
      })
      const timer = setTimeout(() => child.kill(), 60_000)
      const [status, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      clearTimeout(timer)
      if (logDir) await fs.writeFile(path.join(logDir, `d1-producer-${name}.log`), `${stdout}\n${stderr}`)
      if (status !== 0) throw new Error(`${name} exited ${status}\n${stdout}\n${stderr}`)
      return stdout
    }
    try {
      const binary = async (name: string, commit: string) => {
        const outfile = path.join(home, `producer-${name}${process.platform === "win32" ? ".exe" : ""}`)
        await run(`build-${name}`, [
          process.execPath,
          "build",
          "--compile",
          "--conditions=browser",
          "--define",
          `DAX_BUILD_COMMIT=${JSON.stringify(commit)}`,
          "--define",
          `DAX_PRODUCER_VARIANT=${JSON.stringify(name)}`,
          entry,
          "--outfile",
          outfile,
        ])
        return outfile
      }
      const first = await binary("first", "compiled-fixture-first")
      const second = await binary("second", "compiled-fixture-second")
      const unknown = await binary("unknown", "")
      const matrix = JSON.parse((await run("matrix", [first, home, "matrix"])).trim().split("\n").at(-1)!)
      expect(matrix.controls).toEqual([
        "pending",
        "reserved",
        "denied",
        "expired",
        "superseded",
        "approved-unpublished",
        "unactivated",
        "publication-intent-no-proof",
        "stale-artifact",
        "artifact-run-mismatch",
        "artifact-schema-mismatch",
        "missing-artifact",
        "missing-review-with-journal-authority",
        "missing-review-old-v1-artifact-denied",
        "missing-pending-review-old-v1-artifact-denied",
        "missing-review-unreadable-marker-old-v1-denied",
        "missing-review-corrupt-journal-old-v1-denied",
        "malformed-authority-marker",
        "corrupt-review",
        "corrupt-review-proposal",
        "altered-activation-manifest",
        "reordered-activation-manifest",
        "activation-revision-mismatch",
        "altered-remote-activation-manifest",
        "reordered-remote-activation-manifest",
        "malformed-source-selector",
        "malformed-activation",
        "raw-review-storage-failure",
        "unreadable-review-structure",
        "activated-v1-write-refused",
        "genuine-native-SessionPrompt-read",
        "idle-does-not-complete",
        "journal-replay",
        "genuine-remote-only-SessionPrompt",
        "terminal-readable-no-dispatch",
      ])
      expect(matrix.controls).toContain("genuine-native-SessionPrompt-read")
      expect(matrix.controls).toContain("genuine-remote-only-SessionPrompt")
      expect(matrix.controls).toContain("terminal-readable-no-dispatch")
      expect(matrix.controls).toContain("idle-does-not-complete")
      expect(matrix.controls).toContain("reordered-activation-manifest")
      expect(matrix.controls).toContain("missing-review-with-journal-authority")
      expect(matrix.controls).toContain("unreadable-review-structure")
      expect(matrix.providerCalls).toBeGreaterThanOrEqual(3)
      const debugOutput = (await run("debug", [first, home, "debug"])).trim().split("\n")
      const debug = JSON.parse(debugOutput.pop()!)
      const debugResult = JSON.parse(debugOutput.join("\n"))
      expect(debug.controls).toEqual(["compiled-debug-handler-real-read-explicit-no-contract"])
      expect(debugResult.authority).toMatchObject({
        path: "native_tool",
        basis: "no_contract",
        enforcement: "record_only",
        reasonCode: "no_governing_contract",
      })
      expect(debugResult.result.output).toContain("D1 compiled producer evidence")
      const identity = JSON.parse((await run("identity", [first, home, "identity"])).trim().split("\n").at(-1)!)
      expect(identity.controls).toEqual([
        "compiled-session-projectID-mismatch-before-model-and-journal",
        "compiled-session-id-mismatch-before-model-and-journal",
        "compiled-owned-pending-review-cannot-borrow-another-root",
      ])
      const asked = JSON.parse((await run("ask", [first, home, "ask"])).trim().split("\n").at(-1)!)
      expect(asked.controls).toEqual([
        "compiled-ask-zero-effects-before-route-approval",
        "compiled-remembered-exact-tuple-second-real-dispatch",
        "compiled-ask-denial-and-no-cross-run-memory-effects",
      ])
      expect(asked.mcpCalls.gamma.tool).toBe(2)
      const sdlc = JSON.parse((await run("sdlc", [first, home, "sdlc"])).trim().split("\n").at(-1)!)
      expect(sdlc.controls).toEqual([
        "compiled-SDLC-explicit-reviewed-reference-no-command-effects",
        "compiled-SDLC-unscoped-operator-real-command-compatibility",
        "compiled-SDLC-v1-bound-reference-real-command-compatibility",
        "compiled-SDLC-missing-session-reference-no-fallback-effects",
      ])
      const interrupted = Bun.spawn([first, home, "kill-open"], {
        cwd: path.resolve(import.meta.dir, "../.."),
        env,
        stdout: "pipe",
        stderr: "pipe",
      })
      const interruptedStdout = new Response(interrupted.stdout).text()
      const interruptedStderr = new Response(interrupted.stderr).text()
      try {
        const deadline = Date.now() + 30_000
        const ready = path.join(home, "process-interruption-ready.json")
        while (true) {
          if (
            await fs.stat(ready).then(
              () => true,
              (error) => {
                if (error.code === "ENOENT") return false
                throw error
              },
            )
          )
            break
          if (interrupted.exitCode !== null)
            throw new Error("Interruption producer exited before durable provider dispatch")
          if (Date.now() >= deadline) throw new Error("Interruption producer never reached durable provider dispatch")
          await Bun.sleep(25)
        }
        expect(interrupted.exitCode).toBeNull()
        interrupted.kill("SIGKILL")
        expect(await interrupted.exited).not.toBe(0)
      } finally {
        if (interrupted.exitCode === null) interrupted.kill("SIGKILL")
        const [status, stdout, stderr] = await Promise.all([interrupted.exited, interruptedStdout, interruptedStderr])
        if (logDir)
          await fs.writeFile(path.join(logDir, "d1-producer-OS-kill.log"), JSON.stringify({ status, stdout, stderr }))
      }
      const restarted = JSON.parse(
        (await run("restart-open", [first, home, "restart-open"])).trim().split("\n").at(-1)!,
      )
      expect(restarted.controls).toEqual(["compiled-OS-kill-open-message-recovery-no-provider-replay"])
      expect(restarted.providerCalls).toBe(0)
      const mcp = JSON.parse((await run("mcp", [first, home, "mcp"])).trim().split("\n").at(-1)!)
      expect(mcp.controls).toEqual([
        "compiled-MCP-tool-actual-call",
        "compiled-MCP-resource-actual-read",
        "compiled-MCP-prompt-actual-fetch",
        "compiled-MCP-cross-server-zero-effects-and-replay",
      ])
      expect(mcp.mcpCalls).toEqual({
        gamma: { tool: 1, resource: 1, prompt: 1 },
        delta: { tool: 0, resource: 0, prompt: 0 },
      })
      const delegation = JSON.parse((await run("delegation", [first, home, "delegation"])).trim().split("\n").at(-1)!)
      expect(delegation.controls).toEqual([
        "compiled-TaskTool-fresh-child-real-read",
        "compiled-TaskTool-same-child-resume",
        "compiled-TaskTool-granted-missing-agent-no-fallback-child",
      ])
      const graph = JSON.parse((await run("graph", [first, home, "graph"])).trim().split("\n").at(-1)!)
      expect(graph.controls).toEqual([
        "compiled-graph-root-child-durable-denials",
        "compiled-graph-no-contract-compatibility",
      ])
      expect(graph.providerCalls).toBe(0)
      const api = JSON.parse((await run("api", [first, home, "api"])).trim().split("\n").at(-1)!)
      expect(api.controls).toEqual([
        "api-preflight-no-session-authority-provider",
        "api-actual-validator-and-missing-errors-no-effects",
        "api-complete-stale-pins-no-append",
        "api-grant-actor-remember-validation-before-append",
        "api-server-produced-revision-fresh-approval",
        "api-grant-approval-no-workflow-resume",
        "api-activated-queued-all-session-entries-no-effects",
        "api-r2-completion-canonical-supersession",
        "api-genuine-start-at-most-one-dispatch",
        "api-r3-completion-multi-revision-proof",
        "api-non-superseded-approvals-block-before-artifacts",
        "api-neutral-intent-explicit-roots-consequential-grants-disclosed",
        "api-denied-review-readable-no-start",
        "api-cross-process-one-initial-model-dispatch",
        "api-activated-unstarted-waiting-no-dispatch-effects",
        "api-claim-before-dispatch-never-retried",
        "api-publication-proof-crash-roll-forward",
        "api-ask-remember-validation-routing-no-workflow-resume",
        "api-wrong-approval-type-remember-no-append",
        "api-successor-fresh-authority-no-copy",
      ])
      const other = JSON.parse((await run("other-image", [second, home, "other-image"])).trim().split("\n").at(-1)!)
      expect(other.controls).toEqual([
        "changed-image-native-binding-denied",
        "remote-only-second-compiled-image-allowed",
      ])
      const source = JSON.parse(
        (await run("source", [process.execPath, "--conditions=browser", entry, home, "source"]))
          .trim()
          .split("\n")
          .at(-1)!,
      )
      expect(source.controls).toEqual([
        "source-api-create-start-no-effects",
        "source-native-denied",
        "source-remote-only-denied",
        "source-direct-action-denied",
      ])
      expect(source.providerCalls).toBe(0)
      const missing = JSON.parse((await run("unknown", [unknown, home, "unknown"])).trim().split("\n").at(-1)!)
      expect(missing.controls).toEqual(["unknown-image-remote-only-denied"])
      expect(missing.providerCalls).toBe(0)
      console.log(
        JSON.stringify({
          stage4d: matrix,
          debug,
          identity,
          asked,
          sdlc,
          restarted,
          mcp,
          delegation,
          graph,
          api,
          otherImage: other,
          source,
          unknown: missing,
        }),
      )
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  }, 180_000)
})

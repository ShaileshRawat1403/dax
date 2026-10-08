import { expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import { pathToFileURL } from "node:url"

test("persisted retired OAuth fails preflight without mutation; an environment API key remains usable", async () => {
  const root = await mkdtemp(join(tmpdir(), "dax-retired-oauth-"))
  const project = join(root, "project")
  const entry = join(root, "probe.ts")
  const moduleURL = (name: string) => JSON.stringify(pathToFileURL(resolve(import.meta.dir, "..", name)).href)
  try {
    await mkdir(project)
    await writeFile(entry, `
      import { Auth } from ${moduleURL("auth/index.ts")};
      import { Env } from ${moduleURL("env/index.ts")};
      import { Instance } from ${moduleURL("project/instance.ts")};
      import { diagnoseProviderAuth, assertProviderAuth } from ${moduleURL("provider/auth-preflight.ts")};
      import { deepStrictEqual, strictEqual, rejects } from "node:assert";
      try {
        await Instance.provide({ directory: ${JSON.stringify(project)}, fn: async () => {
          for (const id of ["anthropic", "claude-code"]) {
            await Auth.set(id, { type: "oauth", access: "fixture-access", refresh: "fixture-refresh", expires: Date.now()+60000 });
            const before = await Auth.all();
            const denied = await diagnoseProviderAuth(id);
            strictEqual(denied.ok, false);
            strictEqual(denied.failureCategory, "misconfigured");
            await rejects(assertProviderAuth(id), /claude_subscription_oauth_retired/);
            deepStrictEqual(await Auth.all(), before);
            Env.set("ANTHROPIC_API_KEY", "fixture-api-key");
            const allowed = await diagnoseProviderAuth(id);
            strictEqual(allowed.ok, true);
            strictEqual(allowed.mode, "anthropic-api");
            await assertProviderAuth(id);
            deepStrictEqual(await Auth.all(), before);
            Env.remove("ANTHROPIC_API_KEY");
          }
        }});
      } finally { await Instance.disposeAll(); }
      console.log("retirement-controls-ok");
    `)
    const child = Bun.spawn([process.execPath, "run", entry], {
      cwd: resolve(import.meta.dir, "../../../.."),
      env: { ...process.env, DAX_TEST_HOME: join(root, "home"),
        XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"),
        XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache"),
        ANTHROPIC_API_KEY: "", CLAUDE_API_KEY: "", DAX_DISABLE_MODELS_FETCH: "1",
        DAX_DISABLE_CONFIG_AUTO_INSTALL: "1" },
      stdout: "pipe", stderr: "pipe",
    })
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect({ exit, stderr: exit ? stderr : "" }).toEqual({ exit: 0, stderr: "" })
    expect(stdout).toContain("retirement-controls-ok")
  } finally { await rm(root, { recursive: true, force: true }) }
}, 40_000)

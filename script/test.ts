#!/usr/bin/env bun

const args = process.argv.slice(2)
const proc = Bun.spawn(["bun", "test", "packages", "--max-concurrency", "1", ...args], {
  cwd: process.cwd(),
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
  env: {
    ...process.env,
    DAX_DISABLE_MODELS_FETCH: process.env.DAX_DISABLE_MODELS_FETCH ?? "1",
    DAX_EXPERIMENTAL_DISABLE_FILEWATCHER: process.env.DAX_EXPERIMENTAL_DISABLE_FILEWATCHER ?? "1",
    DAX_DISABLE_CONFIG_AUTO_INSTALL: process.env.DAX_DISABLE_CONFIG_AUTO_INSTALL ?? "1",
  },
})

process.exit(await proc.exited)

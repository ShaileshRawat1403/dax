#!/usr/bin/env bun

import os from "os"
import path from "path"
import { mkdir, rm } from "fs/promises"

const testHome = process.env.DAX_TEST_HOME || path.join(os.tmpdir(), `dax-test-home-${process.pid}-${Date.now()}`)
await mkdir(testHome, { recursive: true })

const args = process.argv.slice(2)
const proc = Bun.spawn(["bun", "test", "packages", "--max-concurrency", "1", ...args], {
  cwd: process.cwd(),
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
  env: {
    ...process.env,
    DAX_TEST_HOME: testHome,
    DAX_DISABLE_MODELS_FETCH: process.env.DAX_DISABLE_MODELS_FETCH ?? "1",
    DAX_EXPERIMENTAL_DISABLE_FILEWATCHER: process.env.DAX_EXPERIMENTAL_DISABLE_FILEWATCHER ?? "1",
    DAX_DISABLE_CONFIG_AUTO_INSTALL: process.env.DAX_DISABLE_CONFIG_AUTO_INSTALL ?? "1",
  },
})

const exitCode = await proc.exited

if (!process.env.DAX_TEST_HOME) {
  await rm(testHome, { recursive: true, force: true }).catch(() => {})
}

process.exit(exitCode)

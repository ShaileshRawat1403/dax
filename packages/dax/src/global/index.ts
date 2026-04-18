import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"
import { readEnv } from "@/flag/flag"

const app = "dax"

function homeDir() {
  return readEnv("DAX_TEST_HOME") || os.homedir()
}

function xdgDir(kind: "data" | "cache" | "config" | "state") {
  const testHome = readEnv("DAX_TEST_HOME")
  if (testHome) {
    const roots = {
      data: path.join(testHome, ".local", "share"),
      cache: path.join(testHome, ".cache"),
      config: path.join(testHome, ".config"),
      state: path.join(testHome, ".local", "state"),
    }
    return path.join(roots[kind], app)
  }

  const resolved =
    kind === "data"
      ? xdgData
      : kind === "cache"
        ? xdgCache
        : kind === "config"
          ? xdgConfig
          : xdgState

  return path.join(resolved!, app)
}

export namespace Global {
  export const Path = {
    get home() {
      return homeDir()
    },
    get data() {
      return xdgDir("data")
    },
    get bin() {
      return path.join(Global.Path.data, "bin")
    },
    get log() {
      return path.join(Global.Path.data, "log")
    },
    get cache() {
      return xdgDir("cache")
    },
    get config() {
      return xdgDir("config")
    },
    get state() {
      return xdgDir("state")
    },
  }

  export async function ensureDirectories() {
    await Promise.all([
      fs.mkdir(Global.Path.data, { recursive: true }),
      fs.mkdir(Global.Path.config, { recursive: true }),
      fs.mkdir(Global.Path.state, { recursive: true }),
      fs.mkdir(Global.Path.log, { recursive: true }),
      fs.mkdir(Global.Path.bin, { recursive: true }),
      fs.mkdir(Global.Path.cache, { recursive: true }),
    ])
  }
}

await Global.ensureDirectories()

const CACHE_VERSION = "21"

const version = await Bun.file(path.join(Global.Path.cache, "version"))
  .text()
  .catch(() => "0")

if (version !== CACHE_VERSION) {
  try {
    const contents = await fs.readdir(Global.Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Global.Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch (e) {
    /* Intentionally ignored: cache directory might be empty or inaccessible. */
  }
  await Bun.file(path.join(Global.Path.cache, "version")).write(CACHE_VERSION)
}

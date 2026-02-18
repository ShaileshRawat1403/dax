export function readEnv(key: string) {
  const direct = process.env[key]
  if (direct !== undefined) return direct
  if (!key.startsWith("DAX_")) return undefined
  return process.env[`OPENCODE_${key.slice(4)}`]
}

function truthy(key: string) {
  const value = readEnv(key)?.toLowerCase()
  return value === "true" || value === "1"
}

export namespace Flag {
  export const DAX_AUTO_SHARE = truthy("DAX_AUTO_SHARE")
  export const DAX_GIT_BASH_PATH = readEnv("DAX_GIT_BASH_PATH")
  export const DAX_CONFIG = readEnv("DAX_CONFIG")
  export declare const DAX_CONFIG_DIR: string | undefined
  export const DAX_CONFIG_CONTENT = readEnv("DAX_CONFIG_CONTENT")
  export const DAX_DISABLE_AUTOUPDATE = truthy("DAX_DISABLE_AUTOUPDATE")
  export const DAX_DISABLE_PRUNE = truthy("DAX_DISABLE_PRUNE")
  export const DAX_DISABLE_TERMINAL_TITLE = truthy("DAX_DISABLE_TERMINAL_TITLE")
  export const DAX_PERMISSION = readEnv("DAX_PERMISSION")
  export const DAX_DISABLE_SHARE = truthy("DAX_DISABLE_SHARE")
  export const DAX_DISABLE_DEFAULT_PLUGINS = truthy("DAX_DISABLE_DEFAULT_PLUGINS")
  export const DAX_DISABLE_LSP_DOWNLOAD = truthy("DAX_DISABLE_LSP_DOWNLOAD")
  export const DAX_ENABLE_EXPERIMENTAL_MODELS = truthy("DAX_ENABLE_EXPERIMENTAL_MODELS")
  export const DAX_DISABLE_AUTOCOMPACT = truthy("DAX_DISABLE_AUTOCOMPACT")
  export const DAX_DISABLE_MODELS_FETCH = truthy("DAX_DISABLE_MODELS_FETCH")
  export const DAX_DISABLE_CLAUDE_CODE = truthy("DAX_DISABLE_CLAUDE_CODE")
  export const DAX_DISABLE_CLAUDE_CODE_PROMPT =
    DAX_DISABLE_CLAUDE_CODE || truthy("DAX_DISABLE_CLAUDE_CODE_PROMPT")
  export const DAX_DISABLE_CLAUDE_CODE_SKILLS =
    DAX_DISABLE_CLAUDE_CODE || truthy("DAX_DISABLE_CLAUDE_CODE_SKILLS")
  export const DAX_DISABLE_EXTERNAL_SKILLS =
    DAX_DISABLE_CLAUDE_CODE_SKILLS || truthy("DAX_DISABLE_EXTERNAL_SKILLS")
  export declare const DAX_DISABLE_PROJECT_CONFIG: boolean
  export const DAX_FAKE_VCS = readEnv("DAX_FAKE_VCS")
  export declare const DAX_CLIENT: string
  export const DAX_SERVER_PASSWORD = readEnv("DAX_SERVER_PASSWORD")
  export const DAX_SERVER_USERNAME = readEnv("DAX_SERVER_USERNAME")
  export const DAX_API = readEnv("DAX_API")

  // Experimental
  export const DAX_EXPERIMENTAL = truthy("DAX_EXPERIMENTAL")
  export const DAX_EXPERIMENTAL_FILEWATCHER = truthy("DAX_EXPERIMENTAL_FILEWATCHER")
  export const DAX_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("DAX_EXPERIMENTAL_DISABLE_FILEWATCHER")
  export const DAX_EXPERIMENTAL_ICON_DISCOVERY =
    DAX_EXPERIMENTAL || truthy("DAX_EXPERIMENTAL_ICON_DISCOVERY")
  export const DAX_EXPERIMENTAL_DISABLE_COPY_ON_SELECT = truthy("DAX_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const DAX_ENABLE_EXA =
    truthy("DAX_ENABLE_EXA") || DAX_EXPERIMENTAL || truthy("DAX_EXPERIMENTAL_EXA")
  export const DAX_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("DAX_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const DAX_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("DAX_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const DAX_EXPERIMENTAL_OXFMT = DAX_EXPERIMENTAL || truthy("DAX_EXPERIMENTAL_OXFMT")
  export const DAX_EXPERIMENTAL_LSP_TY = truthy("DAX_EXPERIMENTAL_LSP_TY")
  export const DAX_EXPERIMENTAL_LSP_TOOL = DAX_EXPERIMENTAL || truthy("DAX_EXPERIMENTAL_LSP_TOOL")
  export const DAX_DISABLE_FILETIME_CHECK = truthy("DAX_DISABLE_FILETIME_CHECK")
  export const DAX_EXPERIMENTAL_PLAN_MODE = DAX_EXPERIMENTAL || truthy("DAX_EXPERIMENTAL_PLAN_MODE")
  export const DAX_EXPERIMENTAL_MARKDOWN = truthy("DAX_EXPERIMENTAL_MARKDOWN")
  export const DAX_MODELS_URL = readEnv("DAX_MODELS_URL")
  export const DAX_MODELS_PATH = readEnv("DAX_MODELS_PATH")

  function number(key: string) {
    const value = readEnv(key)
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for DAX_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "DAX_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("DAX_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for DAX_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "DAX_CONFIG_DIR", {
  get() {
    return readEnv("DAX_CONFIG_DIR")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for DAX_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "DAX_CLIENT", {
  get() {
    return readEnv("DAX_CLIENT") ?? "cli"
  },
  enumerable: true,
  configurable: false,
})

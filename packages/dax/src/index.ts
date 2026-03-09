import { plugin } from "bun"
// @ts-ignore
import solid from "@opentui/solid/bun-plugin"
plugin(solid)

const { default: yargs } = await import("yargs")
const { hideBin } = await import("yargs/helpers")
const { RunCommand } = await import("./cli/cmd/run")
const { GenerateCommand } = await import("./cli/cmd/generate")
const { Log } = await import("./util/log")
const { AuthCommand } = await import("./cli/cmd/auth")
const { AgentCommand } = await import("./cli/cmd/agent")
const { UpgradeCommand } = await import("./cli/cmd/upgrade")
const { UninstallCommand } = await import("./cli/cmd/uninstall")
const { ModelsCommand } = await import("./cli/cmd/models")
const { UI } = await import("./cli/ui")
const { Installation } = await import("./installation")
const { NamedError } = await import("@dax-ai/util/error")
const { FormatError } = await import("./cli/error")
const { ServeCommand } = await import("./cli/cmd/serve")
const { DebugCommand } = await import("./cli/cmd/debug")
const { StatsCommand } = await import("./cli/cmd/stats")
const { McpCommand } = await import("./cli/cmd/mcp")
const { GithubCommand } = await import("./cli/cmd/github")
const { ExportCommand } = await import("./cli/cmd/export")
const { ImportCommand } = await import("./cli/cmd/import")
const { AttachCommand } = await import("./cli/cmd/tui/attach")
const { TuiThreadCommand } = await import("./cli/cmd/tui/thread")
const { AcpCommand } = await import("./cli/cmd/acp")
const { EOL } = await import("os")
const { WebCommand } = await import("./cli/cmd/web")
const { PrCommand } = await import("./cli/cmd/pr")
const { SessionCommand } = await import("./cli/cmd/session")
const { AuditCommand } = await import("./cli/cmd/audit")
const { DoctorCommand } = await import("./cli/cmd/doctor")
const { DocsCommand } = await import("./cli/cmd/docs")
const { HELP_GROUPS } = await import("./cli/help")

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

const cli = yargs(hideBin(process.argv))
  .parserConfiguration({ "populate--": true })
  .scriptName("dax")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", Installation.VERSION)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .middleware(async (opts) => {
    await Log.init({
      print: process.argv.includes("--print-logs"),
      dev: Installation.isLocal(),
      level: (() => {
        if (opts.logLevel) return opts.logLevel as any
        if (Installation.isLocal()) return "DEBUG"
        return "INFO"
      })(),
    })

    process.env.AGENT = "1"
    process.env.DAX = "1"

    Log.Default.info("dax", {
      version: Installation.VERSION,
      args: process.argv.slice(2),
    })
  })
  .usage("\n" + UI.logo() + EOL + EOL + HELP_GROUPS.split("\n").join(EOL))
  .completion("completion", "generate shell completion script")
  .command(AcpCommand)
  .command(McpCommand)
  .command(TuiThreadCommand)
  .command(AttachCommand)
  .command(RunCommand)
  .command(GenerateCommand)
  .command(DebugCommand)
  .command(AuthCommand)
  .command(AgentCommand)
  .command(UpgradeCommand)
  .command(UninstallCommand)
  .command(ServeCommand)
  .command(WebCommand)
  .command(ModelsCommand)
  .command(StatsCommand)
  .command(AuditCommand)
  .command(DocsCommand)
  .command(DoctorCommand)
  .command(ExportCommand)
  .command(ImportCommand)
  .command(GithubCommand)
  .command(PrCommand)
  .command(SessionCommand)
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp("log")
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  await cli.parse()
} catch (e) {
  const data: Record<string, any> = {}
  if (e instanceof NamedError) {
    const obj = e.toObject()
    Object.assign(data, {
      ...obj.data,
    })
  }

  if (e instanceof Error) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      cause: e.cause?.toString(),
      stack: e.stack,
    })
  }

  Log.Default.error("fatal", data)
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error, check log file at " + Log.file() + " for more details" + EOL)
    console.error(e instanceof Error ? e.message : String(e))
  }
  process.exitCode = 1
} finally {
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Avoid forcing exit for long-running or interactive commands unless explicitly requested.
  if (process.env.DAX_FORCE_EXIT === "1") process.exit()
}

import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import {
  aggregateDoctorReport,
  authSection,
  doctorExitCode,
  type DoctorSection,
  envSection,
  formatDoctorReport,
  formatDoctorSection,
  mcpSection,
  projectSection,
} from "@/doctor"

type DoctorArgs = {
  json?: boolean
  model?: string
}

function writeJson(data: unknown) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n")
}

async function runSection(args: DoctorArgs, title: string, fn: () => Promise<DoctorSection>) {
  const section = await bootstrap(process.cwd(), fn)
  if (args.json) {
    writeJson(section)
  } else {
    UI.empty()
    prompts.intro(title)
    prompts.log.message(formatDoctorSection(section))
    prompts.outro("Done")
  }
  process.exitCode = doctorExitCode(section.state)
}

export const DoctorAuthCommand = cmd({
  command: "auth [model]",
  describe: "inspect provider authentication readiness",
  builder: (yargs) =>
    yargs
      .positional("model", {
        describe: "Optional model in provider/model format, e.g. google/gemini-2.5-flash",
        type: "string",
      })
      .option("json", {
        describe: "output machine-readable JSON",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    await runSection(args, "Doctor: auth", () => authSection(args.model))
  },
})

export const DoctorMcpCommand = cmd({
  command: "mcp",
  describe: "inspect MCP readiness and next actions",
  builder: (yargs) =>
    yargs.option("json", {
      describe: "output machine-readable JSON",
      type: "boolean",
      default: false,
    }),
  async handler(args) {
    await runSection(args, "Doctor: mcp", () => mcpSection())
  },
})

export const DoctorEnvCommand = cmd({
  command: "env",
  describe: "inspect local environment readiness",
  builder: (yargs) =>
    yargs.option("json", {
      describe: "output machine-readable JSON",
      type: "boolean",
      default: false,
    }),
  async handler(args) {
    await runSection(args, "Doctor: env", () => envSection(process.cwd()))
  },
})

export const DoctorProjectCommand = cmd({
  command: "project",
  describe: "inspect current project/workspace readiness",
  builder: (yargs) =>
    yargs.option("json", {
      describe: "output machine-readable JSON",
      type: "boolean",
      default: false,
    }),
  async handler(args) {
    await runSection(args, "Doctor: project", () => projectSection(process.cwd()))
  },
})

export const DoctorCommand = cmd({
  command: "doctor [model]",
  describe: "run readiness diagnostics across auth, MCP, environment, and project state",
  builder: (yargs) =>
    yargs
      .positional("model", {
        describe: "Optional model in provider/model format for auth-focused checks",
        type: "string",
      })
      .option("json", {
        describe: "output machine-readable JSON",
        type: "boolean",
        default: false,
      })
      .command(DoctorAuthCommand)
      .command(DoctorMcpCommand)
      .command(DoctorEnvCommand)
      .command(DoctorProjectCommand),
  async handler(args) {
    const report = await bootstrap(process.cwd(), () => aggregateDoctorReport(process.cwd(), args.model))
    if (args.json) {
      writeJson(report)
    } else {
      UI.empty()
      prompts.intro("DAX doctor")
      prompts.log.message(formatDoctorReport(report))
      prompts.outro("Done")
    }
    process.exitCode = doctorExitCode(report.state)
  },
})

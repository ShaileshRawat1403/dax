import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { aggregateDoctorReport, doctorExitCode } from "@/doctor"
import { formatStartGuide } from "@/doctor/start-guide"

/**
 * The front door for new users. `dax start` runs the same readiness checks as
 * `dax doctor`, but presents them as a plain-language, ordered checklist of what
 * to do next, so a non-developer is never dropped into a cryptic failure.
 */
export const StartCommand = cmd({
  command: "start",
  describe: "get set up: a plain-language checklist of what DAX needs before your first run",
  builder: (yargs) =>
    yargs.option("json", {
      describe: "output the full machine-readable readiness report",
      type: "boolean",
      default: false,
    }),
  async handler(args) {
    const report = await bootstrap(process.cwd(), () => aggregateDoctorReport(process.cwd()))
    if (args.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n")
    } else {
      UI.empty()
      prompts.intro("Welcome to DAX")
      prompts.log.message(formatStartGuide(report))
      prompts.outro(report.readiness === "ready" ? "You're ready." : "Fix the steps above, then run `dax start` again.")
    }
    process.exitCode = doctorExitCode(report.readiness)
  },
})

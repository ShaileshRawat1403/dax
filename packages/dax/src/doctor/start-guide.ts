import type { DoctorReport } from "./index"

/**
 * Plain-language onboarding view over the doctor report. `dax start` renders
 * this so a non-developer sees, in order, exactly what DAX still needs and the
 * one command that fixes each item, instead of reading a diagnostics dump.
 *
 * A pure presenter over aggregateDoctorReport: it invents no checks and no
 * remedies of its own, so it cannot drift from what `dax doctor` actually
 * verifies. Each pending item's action is that section's own first `next` step
 * (blocked items are listed before merely degraded ones).
 */
export function formatStartGuide(report: DoctorReport): string {
  const blocked = report.sections.filter((s) => s.readiness === "blocked")
  const degraded = report.sections.filter((s) => s.readiness === "degraded")
  const pending = [...blocked, ...degraded]

  if (pending.length === 0) {
    return [
      "DAX is ready. Everything it needs is in place.",
      "",
      "Try your first governed run:",
      '  dax worker run claude -- "add a test for one small file"',
    ].join("\n")
  }

  const stepWord = pending.length === 1 ? "step" : "steps"
  const lines = [`You are ${pending.length} ${stepWord} from ready.`, ""]
  pending.forEach((section, index) => {
    const action = section.next[0] ?? section.summary
    lines.push(`${index + 1}. ${section.title}: ${section.summary}`)
    lines.push(`   Next: ${action}`)
  })
  lines.push("", "Work top to bottom, then run `dax start` again to check your progress.")
  return lines.join("\n")
}

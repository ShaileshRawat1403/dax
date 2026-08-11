import { InstanceBootstrap } from "../project/bootstrap"
import { Instance } from "../project/instance"
import { listInterruptedRuns } from "../state/recovery"
import { UI } from "./ui"

async function noticeInterruptedRuns() {
  try {
    const stranded = await listInterruptedRuns()
    if (stranded.length === 0) return
    UI.println(
      UI.Style.TEXT_WARNING_BOLD + "!",
      UI.Style.TEXT_NORMAL +
        `${stranded.length} run${stranded.length === 1 ? "" : "s"} stranded by a process that stopped mid-flight. Run \`dax recover\` to review.`,
    )
  } catch {
    // Best-effort notice; never block a command over it.
  }
}

export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  return Instance.provide({
    directory,
    init: InstanceBootstrap,
    fn: async () => {
      try {
        await noticeInterruptedRuns()
        const result = await cb()
        return result
      } finally {
        await Instance.dispose()
      }
    },
  })
}

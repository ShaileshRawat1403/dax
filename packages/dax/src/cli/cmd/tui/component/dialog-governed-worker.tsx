import { createMemo } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { DialogAlert } from "@tui/ui/dialog-alert"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useRoute } from "@tui/context/route"
import { useToast } from "@tui/ui/toast"
import { deriveDefaultValidationCommands } from "@/execution/default-validation-commands"
import type { ExternalWorkerId } from "@/worker/worker-adapter"
import { CreateRunResponse } from "@/server/run-contract"
import {
  buildGovernedWorkerRunRequest,
  createGovernedWorkerRun,
  governedWorkerOptions,
  parseWorkerScope,
  renderGovernedWorkerPreview,
} from "./governed-worker-launch"

export function DialogGovernedWorker(props: { initialWorkerId?: ExternalWorkerId } = {}) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const route = useRoute()
  const toast = useToast()
  const repoPath = createMemo(() => sync.data.path.directory || process.cwd())

  async function launch(workerId: ExternalWorkerId) {
    const option = governedWorkerOptions().find((candidate) => candidate.id === workerId)!
    const task = await DialogPrompt.show(dialog, `Task for ${option.title}`, {
      placeholder: "Describe the bounded change",
    })
    if (task === null) return

    const scopeText = await DialogPrompt.show(dialog, "Allowed write scope", {
      description: () => <text>Comma-separated repository paths or globs. DAX rejects writes outside this scope.</text>,
      placeholder: "src/**, test/**",
    })
    if (scopeText === null) return

    const defaultVerification = deriveDefaultValidationCommands(repoPath())[0] ?? ""
    const verification = await DialogPrompt.show(dialog, "Verification command", {
      description: () => <text>One allowlisted command DAX runs without network after the worker exits.</text>,
      value: defaultVerification,
      placeholder: "bun test",
    })
    if (verification === null) return

    const input = {
      workerId,
      task,
      repoPath: repoPath(),
      writeScope: parseWorkerScope(scopeText),
      verification: verification.trim() ? [verification.trim()] : [],
      sessionId: route.data.type === "session" ? route.data.sessionID : undefined,
    }

    let preview: string
    try {
      preview = renderGovernedWorkerPreview(input)
      // Validate before showing a confirmation that could not be honored.
      buildGovernedWorkerRunRequest(input)
    } catch (error) {
      await DialogAlert.show(dialog, "Cannot start governed worker", error instanceof Error ? error.message : String(error))
      return
    }

    const confirmed = await DialogConfirm.show(dialog, "Confirm governed worker", preview)
    if (!confirmed) return

    try {
      const created = await createGovernedWorkerRun(input, async (request) => {
        const response = await sdk.fetch(new URL("/runs", sdk.url), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        })
        const value: unknown = await response.json()
        if (!response.ok) {
          throw new Error(`Run creation failed (${response.status}): ${JSON.stringify(value)}`)
        }
        return CreateRunResponse.parse(value)
      })
      dialog.clear()
      route.navigate({ type: "session", sessionID: created.runId })
      toast.show({
        variant: "success",
        message: `${option.title} is running under DAX authority`,
        duration: 3000,
      })
    } catch (error) {
      await DialogAlert.show(dialog, "Governed worker failed to start", error instanceof Error ? error.message : String(error))
    }
  }

  const options = governedWorkerOptions()
    .filter((option) => !props.initialWorkerId || option.id === props.initialWorkerId)
    .map((option) => ({
      title: option.title,
      value: option.id,
      description: option.description,
      category: option.recommended ? "Recommended" : "Other governed workers",
      footer: `${option.binary} · execution host checked at start`,
    }))

  return (
    <DialogSelect
      title={props.initialWorkerId ? "Run Antigravity under DAX" : "Select governed worker"}
      options={options}
      onSelect={(option) => void launch(option.value)}
    />
  )
}

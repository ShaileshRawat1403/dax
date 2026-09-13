import { createSignal, onMount } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogAlert } from "@tui/ui/dialog-alert"
import { useToast } from "@tui/ui/toast"
import { antigravitySession } from "@/worker/antigravity-stream"
import { useRoute } from "@tui/context/route"

export const agyPhaseLabel = {
  starting: "Connecting…",
  responding: "Responding…",
  ready: "Ready to chat",
  sealing: "Preparing review…",
  closed: "Finished for review",
  failed: "Attempt ended",
} as const

const sealed = "Sealed: DAX never replays an uncertain AGY turn."

export function DialogAgySession(props: { sessionID: string }) {
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const route = useRoute()
  const state = () => antigravitySession(sync.session.get(props.sessionID))
  const ended = () => ["closed", "failed"].includes(state()?.phase ?? "")
  // The phase only says that the attempt ended; the reason is the canonical run failure.
  const [stop, setStop] = createSignal<{ label: string; message: string }>()
  onMount(async () => {
    const response = await sdk.fetch(new URL(`/runs/${props.sessionID}/agy/status`, sdk.url)).catch(() => undefined)
    const value = response?.ok ? await response.json().catch(() => undefined) : undefined
    if (value?.stop) setStop(value.stop)
  })
  return (
    <DialogSelect
      title="AGY governed agent"
      options={[
        ...(ended()
          ? [
              {
                title:
                  state()?.phase === "closed" && !stop()
                    ? "Finished for review"
                    : `Attempt ended: ${stop()?.label ?? "reason unavailable"}`,
                value: "reason",
                description: stop()
                  ? `${stop()!.message.split("\n")[0]} ${sealed}`
                  : state()?.phase === "closed"
                    ? "DAX verification and approval continue in this session."
                    : sealed,
                onSelect: () => dialog.clear(),
              },
            ]
          : []),
        {
          title: "Finish and review",
          value: "finish",
          disabled: state()?.phase !== "ready",
          description: state()?.phase === "ready" ? "End this conversation and verify changes for approval" : "Available after AGY finishes replying",
          onSelect: async () => {
            dialog.clear()
            try {
              const response = await sdk.fetch(new URL(`/runs/${props.sessionID}/agy/finish`, sdk.url), {
                method: "POST",
              })
              const result = await response.json()
              if (!response.ok) throw new Error(result.error ?? "Unable to finish AGY conversation.")
              toast.show({ variant: "info", message: "AGY stopped. DAX is preparing the result for review." })
            } catch (error) {
              await DialogAlert.show(dialog, "AGY session", error instanceof Error ? error.message : String(error))
            }
          },
        },
        {
          title: "Stop conversation",
          value: "cancel",
          disabled: ended() || !state(),
          description: "End this governed attempt without review; it cannot be resumed",
          onSelect: async () => {
            await sdk.client.session.abort({ sessionID: props.sessionID })
            dialog.clear()
          },
        },
        {
          title: "Start a new AGY conversation",
          value: "new",
          disabled: !ended(),
          description: "Keep this transcript and return to a fresh chat",
          onSelect: () => { dialog.clear(); route.navigate({ type: "home" }) },
        },
        {
          title: "Back to chat",
          value: "continue",
          description: state() ? agyPhaseLabel[state()!.phase] : "Session unavailable",
          onSelect: () => dialog.clear(),
        },
      ]}
    />
  )
}

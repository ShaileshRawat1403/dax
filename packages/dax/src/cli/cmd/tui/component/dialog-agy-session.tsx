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
  closed: "Conversation closed",
  failed: "Conversation stopped",
} as const

export function DialogAgySession(props: { sessionID: string }) {
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const route = useRoute()
  const state = () => antigravitySession(sync.session.get(props.sessionID))
  return (
    <DialogSelect
      title="AGY governed agent"
      options={[
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
          disabled: ["closed", "failed"].includes(state()?.phase ?? "closed"),
          description: "Stop AGY without submitting changes for approval",
          onSelect: async () => {
            await sdk.client.session.abort({ sessionID: props.sessionID })
            dialog.clear()
          },
        },
        {
          title: "Start a new chat",
          value: "new",
          disabled: !["closed", "failed"].includes(state()?.phase ?? ""),
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

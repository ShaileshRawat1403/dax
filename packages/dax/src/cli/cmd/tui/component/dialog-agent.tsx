import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useRoute } from "@tui/context/route"
import { useKV } from "../context/kv"
import { DAX_SETTING, sessionWorkflowModeKey } from "@/dax/settings"

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()
  const route = useRoute()
  const kv = useKV()
  const workflowKey = createMemo(() =>
    route.data.type === "session" ? sessionWorkflowModeKey(route.data.sessionID) : DAX_SETTING.session_workflow_mode,
  )
  const options = createMemo(() =>
    local.agent.list().map((agent) => ({
      value: agent.name,
      title: agent.name,
      description: agent.description ?? (agent.native ? "native" : "custom"),
    })),
  )

  return (
    <DialogSelect
      title="Select mode"
      current={kv.get(workflowKey(), local.agent.current().name)}
      options={options()}
      onSelect={(option) => {
        kv.set(workflowKey(), option.value)
        local.agent.set(option.value)
        dialog.clear()
      }}
    />
  )
}

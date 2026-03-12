import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useKV } from "../context/kv"
import { DAX_SETTING } from "@/dax/settings"

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()
  const kv = useKV()
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
      current={kv.get(DAX_SETTING.session_workflow_mode, local.agent.current().name)}
      options={options()}
      onSelect={(option) => {
        kv.set(DAX_SETTING.session_workflow_mode, option.value)
        local.agent.set(option.value)
        dialog.clear()
      }}
    />
  )
}

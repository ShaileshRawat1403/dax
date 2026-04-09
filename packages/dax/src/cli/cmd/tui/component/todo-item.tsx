import { useTheme } from "../context/theme"

export interface TodoItemProps {
  status: string
  content: string
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()
  const isCompleted = props.status === "completed" || props.status === "done"
  const isActive = props.status === "in_progress" || props.status === "active"

  return (
    <box flexDirection="row" gap={0}>
      <text
        flexShrink={0}
        style={{
          fg: isActive ? theme.warning : isCompleted ? theme.success : theme.textMuted,
        }}
      >
        [{isCompleted ? "✓" : isActive ? "•" : " "}]{" "}
      </text>
      <text
        flexGrow={1}
        wrapMode="word"
        style={{
          fg: isActive ? theme.warning : isCompleted ? theme.text : theme.textMuted,
        }}
      >
        {props.content}
      </text>
    </box>
  )
}

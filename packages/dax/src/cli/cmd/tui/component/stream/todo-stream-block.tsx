import { For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { TodoItem } from "@tui/component/todo-item"
import { STREAM_INDENT } from "./layout"

export interface TodoEntry {
  id?: string
  status: string
  content: string
}

interface TodoStreamBlockProps {
  todos: TodoEntry[]
}

export function TodoStreamBlock(props: TodoStreamBlockProps) {
  const { theme } = useTheme()
  const isCompleted = (status: string) => status === "completed" || status === "done"

  const visibleTodos = () => {
    if (props.todos.length <= 5) return props.todos
    const active = props.todos.filter((t) => !isCompleted(t.status))
    if (active.length === 0) return props.todos.slice(-5)
    const latestCompleted = [...props.todos].reverse().find((t) => isCompleted(t.status))
    return latestCompleted ? [...active, latestCompleted] : active
  }
  const completedCount = () => props.todos.filter((t) => isCompleted(t.status)).length
  const activeCount = () => props.todos.filter((t) => !isCompleted(t.status)).length
  const hiddenCompletedCount = () => completedCount() - visibleTodos().filter((t) => isCompleted(t.status)).length

  return (
    <Show when={props.todos.length > 0}>
      <box
        flexDirection="column"
        marginTop={0}
        marginBottom={0}
        border={["top", "bottom"]}
        borderColor={theme.borderSubtle}
        paddingTop={0}
        paddingBottom={0}
      >
        <box flexDirection="row" gap={1} paddingLeft={0} paddingRight={0}>
          <text fg={theme.info} attributes={TextAttributes.BOLD}>
            Plan
          </text>
          <text fg={theme.textMuted}>
            {completedCount()}/{props.todos.length} done
          </text>
          <Show when={activeCount() > 0}>
            <text fg={theme.textMuted}>
              · {activeCount()} active
            </text>
          </Show>
        </box>
        <box flexDirection="column">
          <For each={visibleTodos()}>
            {(todo) => <TodoItem status={todo.status} content={todo.content} />}
          </For>
        </box>
        <Show when={hiddenCompletedCount() > 0}>
          <box paddingLeft={STREAM_INDENT.content} paddingTop={0} paddingBottom={0}>
            <text fg={theme.textMuted} dim>
              {hiddenCompletedCount()} completed hidden · {activeCount()} active
            </text>
          </box>
        </Show>
      </box>
    </Show>
  )
}

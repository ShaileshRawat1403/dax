import { For, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { TodoItem } from "@tui/component/todo-item"

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

  const visibleTodos = () => props.todos.filter((t) => t.status !== "completed" || props.todos.length <= 5)
  const completedCount = () => props.todos.filter((t) => t.status === "completed").length
  const activeCount = () => props.todos.filter((t) => t.status !== "completed").length
  const hiddenCompletedCount = () => completedCount() - visibleTodos().filter((t) => t.status === "completed").length

  return (
    <Show when={props.todos.length > 0}>
      <box flexDirection="column" marginTop={0} marginBottom={0}>
        <text fg={theme.borderSubtle}>{"─".repeat(40)}</text>
        <box flexDirection="column">
          <For each={visibleTodos()}>
            {(todo) => <TodoItem status={todo.status} content={todo.content} />}
          </For>
        </box>
        <Show when={hiddenCompletedCount() > 0}>
          <box paddingLeft={2} paddingTop={0} paddingBottom={0}>
            <text fg={theme.textMuted} dim>
              {hiddenCompletedCount()} completed hidden · {activeCount()} active
            </text>
          </box>
        </Show>
        <text fg={theme.borderSubtle}>{"─".repeat(40)}</text>
      </box>
    </Show>
  )
}

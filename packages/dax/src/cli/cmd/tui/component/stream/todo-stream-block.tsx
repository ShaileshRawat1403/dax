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

  return (
    <Show when={props.todos.length > 0}>
      <box flexDirection="column" marginTop={0} marginBottom={0}>
        <text fg={theme.borderSubtle}>{"─".repeat(40)}</text>
        <box flexDirection="column">
          <For each={visibleTodos()}>
            {(todo) => <TodoItem status={todo.status} content={todo.content} />}
          </For>
        </box>
        <text fg={theme.borderSubtle}>{"─".repeat(40)}</text>
      </box>
    </Show>
  )
}

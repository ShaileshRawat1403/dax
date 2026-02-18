import { TextAttributes } from "@opentui/core"
import { For, createSignal, onCleanup, onMount } from "solid-js"
import { useTheme } from "@tui/context/theme"

const GLYPH = [
  "DDDD   AAAAA  X   X",
  "D   D  A   A   X X ",
  "D   D  AAAAA    X  ",
  "D   D  A   A   X X ",
  "DDDD   A   A  X   X",
]

export function Logo() {
  const { theme } = useTheme()
  const [tick, setTick] = createSignal(0)

  onMount(() => {
    const timer = setInterval(() => {
      setTick((x) => (x + 1) % 10)
    }, 130)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <box flexDirection="column" alignItems="center" gap={0}>
      <For each={GLYPH}>
        {(line, row) => (
          <box width={line.length} justifyContent="center">
            <text
              fg={[theme.primary, theme.secondary, theme.text, theme.accent, theme.text][(row() + tick()) % 5]}
              attributes={TextAttributes.BOLD}
              selectable={false}
            >
              {line}
            </text>
          </box>
        )}
      </For>
      <box>
        <text fg={tick() % 6 < 3 ? theme.text : theme.textMuted}>Run · Audit · Override</text>
      </box>
    </box>
  )
}

import { createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { TextAttributes, type TextareaRenderable } from "@opentui/core"
import { useTheme, tint, selectedForeground } from "../../context/theme"
import type { QuestionRequest, QuestionAnswer } from "@dax-ai/sdk/v2"
import { useSDK } from "../../context/sdk"
import { useKeybind } from "../../context/keybind"
import { SplitBorder } from "../../component/border"
import { useSync } from "../../context/sync"
import { useTextareaKeybindings } from "../../component/textarea-keybindings"
import { useDialog } from "../../ui/dialog"

export function QuestionPrompt(props: { request: QuestionRequest }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const keybind = useKeybind()
  const dimensions = useTerminalDimensions()
  const textareaKeybindings = useTextareaKeybindings()
  const dialog = useDialog()

  const [store, setStore] = createStore({
    tab: 0,
    answers: props.request.questions.map(() => ""),
    submitting: false,
  })

  const questions = createMemo(() => props.request.questions)
  const single = createMemo(() => questions().length === 1)
  const current = createMemo(() => questions()[store.tab]!)

  let input: TextareaRenderable

  const selectTab = (index: number) => {
    setStore("tab", index)
    input.set(store.answers[index]!)
    input.focus()
  }

  const nextTab = () => {
    if (store.tab < questions().length - 1) {
      selectTab(store.tab + 1)
    }
  }

  const prevTab = () => {
    if (store.tab > 0) {
      selectTab(store.tab - 1)
    }
  }

  const submit = () => {
    if (store.submitting) return
    setStore("submitting", true)
    sdk.client.question.reply({
      requestID: props.request.id,
      answers: questions().map((q, i) => ({
        question: q.question,
        answer: store.answers[i]!,
      })),
    })
  }

  const reject = () => {
    sdk.client.question.reply({
      requestID: props.request.id,
      answers: [],
    })
  }

  const selectOption = () => {
    if (!current().options?.length) return
    // In multi-choice, we just pick the current selected option index if we implemented it.
    // For now we just focus on text input.
  }

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return

    if (evt.name === "tab") {
      evt.preventDefault()
      if (evt.shift) prevTab()
      else nextTab()
      return
    }

    if (current().options?.length) {
      if (evt.name === "return") {
        evt.preventDefault()
        selectOption()
      }

      if (evt.name === "escape" || keybind.match("app_exit", evt)) {
        evt.preventDefault()
        reject()
      }
    }
  })

  const narrow = createMemo(() => dimensions().width < 80)

  return (
    <box
      backgroundColor={theme.background}
      border={["left"]}
      borderColor={theme.accent}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <Show when={!single()}>
          <box flexDirection="row" gap={1} paddingLeft={1}>
            <For each={questions()}>
              {(q, index) => {
                const isActive = () => index() === store.tab
                const isAnswered = () => {
                  return (store.answers[index()]?.length ?? 0) > 0
                }
                return (
                  <box
                    onMouseUp={() => selectTab(index())}
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={isActive() ? theme.accent : theme.backgroundMenu}
                  >
                    <text fg={isActive() ? selectedForeground(theme, theme.accent) : isAnswered() ? theme.text : theme.textMuted}>
                      {`Q${index() + 1}`}
                    </text>
                  </box>
                )
              }}
            </For>
          </box>
        </Show>
        <box flexDirection="row" gap={1} paddingLeft={1}>
          <text fg={theme.accent}>{"?"}</text>
          <text fg={theme.text}>
            <b>{current().header || "Question"}</b>
          </text>
        </box>
        <box paddingLeft={1}>
          <text fg={theme.textMuted} wrapMode="word">
            {current().question}
          </text>
        </box>
      </box>

      <box
        flexDirection={narrow() ? "column" : "row"}
        flexShrink={0}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={theme.backgroundElement}
        justifyContent={narrow() ? "flex-start" : "space-between"}
        alignItems={narrow() ? "flex-start" : "center"}
        gap={1}
      >
        <textarea
          ref={(val: TextareaRenderable) => {
            input = val
            if (val) val.set(store.answers[store.tab]!)
          }}
          focused
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.primary}
          keyBindings={textareaKeybindings()}
          onChange={(val) => setStore("answers", store.tab, val)}
        />
        <box flexDirection="row" gap={2} flexShrink={0}>
          <box flexDirection="row" gap={1} onMouseUp={submit}>
            <text fg={theme.text}>enter</text>
            <text fg={theme.textMuted}>confirm</text>
          </box>
          <box flexDirection="row" gap={1} onMouseUp={reject}>
            <text fg={theme.text}>esc</text>
            <text fg={theme.textMuted}>reject</text>
          </box>
        </box>
      </box>
    </box>
  )
}

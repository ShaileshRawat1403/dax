import { BoxRenderable, TextareaRenderable } from "@opentui/core"
import { createEffect, type JSX, onCleanup, Show, Switch, Match } from "solid-js"
import "opentui-spinner/solid"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { useSDK } from "@tui/context/sdk"
import { useKeybind } from "@tui/context/keybind"
import { type PromptInfo } from "./history"
import { type AutocompleteRef, Autocomplete } from "./autocomplete"
import { useRenderer } from "@opentui/solid"
import { TuiEvent } from "../../event"
import { useTextareaKeybindings } from "../textarea-keybindings"
import { produce } from "solid-js/store"

import { usePromptState, ELI12_PLACEHOLDER, PLACEHOLDERS, WORKFLOW_AGENT_MODES } from "./prompt-state"
import { usePromptHandlers } from "./prompt-handlers"
import { usePromptDialogs } from "./prompt-dialogs"

export type PromptProps = {
  sessionID?: string
  visible?: boolean
  disabled?: boolean
  panePinned?: boolean
  activePaneMode?: "diff" | "audit" | "approvals" | "memory" | "refine"
  approvalAttentionCount?: number
  questionAttentionCount?: number
  onRefineReady?: (prompt: string) => void
  onSubmit?: () => void
  ref?: (ref: PromptRef) => void
  hint?: JSX.Element
  showPlaceholder?: boolean
}

export type PromptRef = {
  alive: boolean
  focused: boolean
  current: PromptInfo
  set(prompt: PromptInfo): void
  reset(): void
  blur(): void
  focus(): void
  submit(): void
}

export function Prompt(props: PromptProps) {
  let input: TextareaRenderable
  let anchor: BoxRenderable
  let autocomplete: AutocompleteRef

  const keybind = useKeybind()
  const local = useLocal()
  const sdk = useSDK()
  const renderer = useRenderer()
  const { theme, syntax } = useTheme()
  const textareaKeybindings = useTextareaKeybindings()

  const fileStyleId = syntax().getStyleId("extmark.file")!
  const agentStyleId = syntax().getStyleId("extmark.agent")!
  const pasteStyleId = syntax().getStyleId("extmark.paste")!
  let promptPartTypeId = 0

  const state = usePromptState(props)
  const handlers = usePromptHandlers(props, state, {
    input: () => input,
    autocomplete: () => autocomplete,
    promptPartTypeId: () => promptPartTypeId,
    pasteStyleId: () => pasteStyleId,
    fileStyleId: () => fileStyleId,
    agentStyleId: () => agentStyleId,
  })

  usePromptDialogs(props, state, handlers, {
    input: () => input,
    autocomplete: () => autocomplete,
  })

  const unsubPromptAppend = sdk.event.on(TuiEvent.PromptAppend.type, (evt) => {
    if (!input || input.isDestroyed) return
    input.insertText(evt.properties.text)
    setTimeout(() => {
      if (!input || input.isDestroyed) return
      input.getLayoutNode().markDirty()
      input.gotoBufferEnd()
      renderer.requestRender()
    }, 0)
  })

  onCleanup(() => {
    unsubPromptAppend()
  })

  createEffect(() => {
    if (!input || input.isDestroyed) return
    if (props.disabled) input.cursorColor = theme.backgroundElement
    else input.cursorColor = theme.text
  })

  const syncedSessionIDRef = { current: undefined as string | undefined }

  createEffect(() => {
    const sessionID = props.sessionID
    const msg = state.lastUserMessage()

    if (sessionID !== syncedSessionIDRef.current) {
      if (!sessionID || !msg) return

      syncedSessionIDRef.current = sessionID

      const isPrimaryAgent = local.agent.list().some((x) => x.name === msg.agent)
      if (msg.agent && isPrimaryAgent) {
        local.agent.set(msg.agent)
        if (WORKFLOW_AGENT_MODES.has(msg.agent)) {
          state.setWorkflowMode(msg.agent)
        }
        if (msg.model) local.model.set(msg.model)
        if (msg.variant) local.model.variant.set(msg.variant)
      }
    }
  })

  const ref: PromptRef = {
    get alive() {
      return !!input && !input.isDestroyed
    },
    get focused() {
      return !!input && !input.isDestroyed && input.focused
    },
    get current() {
      if (!input || input.isDestroyed) return { input: "", parts: [] }
      return state.store.prompt
    },
    focus() {
      if (!input || input.isDestroyed) return
      input.focus()
    },
    blur() {
      if (!input || input.isDestroyed) return
      input.blur()
    },
    set(prompt) {
      if (!input || input.isDestroyed) return
      input.setText(prompt.input)
      state.setStore("prompt", prompt)
      handlers.restoreExtmarksFromParts(prompt.parts)
      input.gotoBufferEnd()
    },
    reset() {
      if (!input || input.isDestroyed) return
      handlers.clearPrompt()
    },
    submit() {
      if (!input || input.isDestroyed) return
      handlers.submit()
    },
  }

  createEffect(() => {
    if (props.visible !== false) input?.focus()
    if (props.visible === false) input?.blur()
  })

  return (
    <>
      <Autocomplete
        sessionID={props.sessionID}
        ref={(r) => (autocomplete = r)}
        anchor={() => anchor}
        input={() => input}
        setPrompt={(cb) => {
          state.setStore("prompt", produce(cb))
        }}
        setExtmark={(partIndex, extmarkId) => {
          state.setStore("extmarkToPartIndex", (map: Map<number, number>) => {
            const newMap = new Map(map)
            newMap.set(extmarkId, partIndex)
            return newMap
          })
        }}
        value={state.store.prompt.input}
        fileStyleId={fileStyleId}
        agentStyleId={agentStyleId}
        promptPartTypeId={() => promptPartTypeId}
      />
      <box
        ref={(r: BoxRenderable) => (anchor = r)}
        visible={props.visible !== false}
        flexShrink={0}
        width="100%"
        flexDirection="column"
      >
        <box
          backgroundColor={theme.background}
          flexShrink={0}
          borderStyle="single"
          borderTop={true}
          borderLeft={false}
          borderRight={false}
          borderBottom={false}
          borderColor={theme.borderSubtle}
        >
          <box paddingLeft={2} paddingRight={2} paddingTop={0.5} flexShrink={0} backgroundColor={theme.background}>
            <box flexDirection="row" gap={1} alignItems="flex-start">
              <Show when={state.showInputHint()}>
                <spinner frames={state.homeCueFrames()} interval={95} color={state.homeCueColor()} />
              </Show>
              <textarea
                placeholder={
                  props.sessionID
                    ? ""
                    : state.explainMode()
                      ? ELI12_PLACEHOLDER
                      : `Ask DAX clearly: ${PLACEHOLDERS[state.store.placeholder]}`
                }
                textColor={keybind.leader ? theme.textMuted : theme.text}
                focusedTextColor={keybind.leader ? theme.textMuted : theme.text}
                minHeight={1}
                maxHeight={6}
                flexGrow={1}
                onContentChange={() => {
                  const value = input.plainText
                  state.setStore("prompt", "input", value)
                  autocomplete.onInput(value)
                  handlers.syncExtmarksWithPromptParts()
                }}
                keyBindings={textareaKeybindings()}
                onKeyDown={handlers.onKeyDown}
                onSubmit={handlers.submit}
                onPaste={handlers.onPaste}
                ref={(r: TextareaRenderable) => {
                  input = r
                  if (promptPartTypeId === 0) {
                    promptPartTypeId = input.extmarks.registerType("prompt-part")
                  }
                  props.ref?.(ref)
                  setTimeout(() => {
                    if (!input || input.isDestroyed) return
                    input.cursorColor = theme.text
                  }, 0)
                }}
                onMouseDown={(r: any) => r.target?.focus()}
                backgroundColor={theme.backgroundElement}
                focusedBackgroundColor={theme.backgroundElement}
                cursorColor={theme.text}
                syntaxStyle={syntax()}
              />
            </box>
            <box flexDirection="row" flexShrink={0} paddingTop={0.5} gap={1}>
              <text fg={state.highlight()}>{state.store.mode === "shell" ? "Shell" : state.activeWorkflowLabel()}</text>
              <Show when={state.store.mode === "normal"}>
                <box flexDirection="row" gap={1}>
                  <text flexShrink={0} fg={keybind.leader ? theme.textMuted : theme.text}>
                    {local.model.parsed().model}
                  </text>
                  <text fg={theme.textMuted}>{local.model.parsed().provider}</text>
                  <Show when={state.showVariant()}>
                    <text fg={theme.textMuted}>·</text>
                    <text>
                      <span style={{ fg: theme.warning, bold: true }}>{local.model.variant.current()}</span>
                    </text>
                  </Show>
                </box>
              </Show>
            </box>
          </box>
        </box>
        <box
          flexDirection="row"
          justifyContent="space-between"
          width="100%"
          paddingLeft={1}
          paddingRight={1}
          paddingBottom={0.5}
          alignItems="center"
        >
          <box flexGrow={1} flexDirection="row" alignItems="center">
            <Show when={state.status().type !== "idle"}>
              <box
                flexDirection="row"
                gap={1}
                flexGrow={1}
                justifyContent={
                  state.status().type === "retry" || state.status().type === "delayed" ? "space-between" : "flex-start"
                }
              >
                <box flexShrink={0} flexDirection="row" gap={0}>
                  <box marginLeft={1}>
                    <spinner frames={state.homeCueFrames()} interval={95} color={state.homeCueColor()} />
                  </box>
                  <box flexDirection="row" gap={1} flexShrink={0}>
                    {(() => {
                      const retry = () => {
                        const s = state.status()
                        if (s.type !== "retry") return
                        return s
                      }

                      const showRetryHint = () => {
                        const r = retry()
                        return !!r && r.attempt >= 3
                      }

                      return (
                        <Switch>
                          <Match when={showRetryHint()}>
                            <text fg={theme.textMuted}>↻ provider recovering…</text>
                          </Match>
                          <Match
                            when={
                              state.status().type === "delayed" &&
                              state.pendingPermissions() === 0 &&
                              state.pendingQuestions() === 0
                            }
                          >
                            <text fg={theme.textMuted}>provider is slow, still waiting…</text>
                          </Match>
                        </Switch>
                      )
                    })()}
                  </box>
                </box>
                <text fg={state.store.interrupt > 0 ? theme.warning : theme.textMuted}>
                  esc{" "}
                  <span style={{ fg: state.store.interrupt > 0 ? theme.warning : theme.textMuted }}>
                    {state.store.interrupt > 0 ? "again to stop" : "interrupt"}
                  </span>
                </text>
              </box>
            </Show>
          </box>

          <box flexShrink={0} flexDirection="row" gap={1} alignItems="center" justifyContent="space-between">
            <Show when={state.status().type !== "retry"}>
              <box flexDirection="row" gap={1} alignItems="center">
                <Show when={state.store.prompt.input.length > 0}>
                  <box
                    onMouseUp={handlers.handleRefine}
                    backgroundColor={theme.backgroundElement}
                    border={["round"]}
                    borderColor={theme.borderSubtle}
                    paddingLeft={1}
                    paddingRight={1}
                  >
                    <text fg={theme.textMuted}>Refine</text>
                  </box>
                </Show>
                <Show when={state.explainMode()}>
                  <box
                    onMouseUp={() => state.setExplainMode(false)}
                    backgroundColor={theme.success}
                    border={["round"]}
                    borderColor={theme.borderActive}
                    paddingLeft={1}
                    paddingRight={1}
                  >
                    <text fg={theme.background}>ELI12</text>
                  </box>
                </Show>
              </box>
              <box
                onMouseUp={handlers.submit}
                backgroundColor={state.store.prompt.input.length > 0 ? theme.primary : theme.backgroundElement}
                border={["round"]}
                borderColor={state.store.prompt.input.length > 0 ? theme.borderActive : theme.borderSubtle}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={state.store.prompt.input.length > 0 ? theme.background : theme.textMuted}>Send ↵</text>
              </box>
            </Show>
          </box>
        </box>
      </box>
    </>
  )
}

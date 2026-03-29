import { useTheme } from "@tui/context/theme"
import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { createEffect, Show, For, createMemo, onCleanup } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useTextareaKeybindings } from "../textarea-keybindings"
import { setSkipRefocus } from "../../app"
import { isRefineSubmitKey } from "./refine-key"

function sectionCount(input: string, heading: string) {
  const match = input.match(new RegExp(`^##\\s+${heading}[\\s\\S]*?(?=^##\\s+|$)`, "m"))
  if (!match) return 0
  return match[0]
    .split("\n")
    .filter((line) => /^\s*(?:-|\d+\.)\s+/.test(line))
    .length
}

function extractSection(input: string, heading: string) {
  const match = input.match(new RegExp(`^##\\s+${heading}[\\s\\S]*?(?=^##\\s+|$)`, "m"))
  if (!match) return []
  return match[0]
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\s*(?:-|\d+\.)\s+/, "").trim())
    .filter(Boolean)
}

function extractKeyedItems(input: string, heading: string) {
  return extractSection(input, heading).map((line) => {
    const match = line.match(/^([^:]+):\s+(.+)$/)
    if (!match) return { label: "", value: line }
    return { label: match[1]!.trim(), value: match[2]!.trim() }
  })
}

function extractSubsection(input: string, heading: string, subheading: string) {
  const sectionMatch = input.match(new RegExp(`^##\\s+${heading}[\\s\\S]*?(?=^##\\s+|$)`, "m"))
  if (!sectionMatch) return []
  const section = sectionMatch[0]
  const subsectionMatch = section.match(new RegExp(`^###\\s+${subheading}[\\s\\S]*?(?=^###\\s+|$)`, "m"))
  if (!subsectionMatch) return []
  return subsectionMatch[0]
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\s*(?:-|\d+\.)\s+/, "").trim())
    .filter(Boolean)
}

export function RefinePane(props: {
  initialPrompt: string
  onUpdate: (prompt: string) => void
  onSubmit?: () => void
}) {
  const { theme } = useTheme()
  let textareaRef: TextareaRenderable | undefined
  let focusTimer: ReturnType<typeof setTimeout> | undefined
  const textareaKeybindings = useTextareaKeybindings()
  const contextCount = () => sectionCount(props.initialPrompt || "", "Session Context")
  const planCount = () => sectionCount(props.initialPrompt || "", "Execution Plan")
  const successCount = () => sectionCount(props.initialPrompt || "", "Success Criteria")
  const watchoutCount = () => sectionCount(props.initialPrompt || "", "Operator Watchouts")
  const targetCount = () => sectionCount(props.initialPrompt || "", "Likely Targets")
  const writesCount = () => sectionCount(props.initialPrompt || "", "Likely Writes")
  const validationCount = () => sectionCount(props.initialPrompt || "", "Validation Commands")
  const validationPlanCount = () => sectionCount(props.initialPrompt || "", "Validation Plan")
  const approvalCount = () => sectionCount(props.initialPrompt || "", "Approval Forecast")
  const governanceCount = () => sectionCount(props.initialPrompt || "", "Governance Hints")
  const deltaCount = () => sectionCount(props.initialPrompt || "", "Contract Delta")
  const impactCount = () => sectionCount(props.initialPrompt || "", "Repo Impact")
  const unknownCount = () => sectionCount(props.initialPrompt || "", "Unknowns & Assumptions")
  const rollbackCount = () => sectionCount(props.initialPrompt || "", "Rollback & Recovery")
  const executionProfile = createMemo(() => {
    const match = (props.initialPrompt || "").match(/^##\s+Execution Profile\s+([\s\S]*?)(?=^##\s+|$)/m)
    return (
      match?.[1]
        ?.split("\n")
        .map((line) => line.trim().replace(/^\s*-\s+/, ""))
        .filter(Boolean) || []
    )
  })
  const goalText = createMemo(() => {
    const match = (props.initialPrompt || "").match(/^##\s+Goal\s+([\s\S]*?)(?=^##\s+|$)/m)
    return match?.[1]?.trim() || ""
  })
  const contextItems = createMemo(() => extractSection(props.initialPrompt || "", "Session Context"))
  const targetItems = createMemo(() => extractSection(props.initialPrompt || "", "Likely Targets"))
  const writeItems = createMemo(() => extractSection(props.initialPrompt || "", "Likely Writes"))
  const planItems = createMemo(() => extractSection(props.initialPrompt || "", "Execution Plan"))
  const successItems = createMemo(() => extractSection(props.initialPrompt || "", "Success Criteria"))
  const validationItems = createMemo(() => extractSection(props.initialPrompt || "", "Validation Commands"))
  const validationPreflight = createMemo(() => extractSubsection(props.initialPrompt || "", "Validation Plan", "Preflight"))
  const validationPostChange = createMemo(() => extractSubsection(props.initialPrompt || "", "Validation Plan", "Post-change"))
  const validationShipReadiness = createMemo(() => extractSubsection(props.initialPrompt || "", "Validation Plan", "Ship readiness"))
  const approvalItems = createMemo(() => extractSection(props.initialPrompt || "", "Approval Forecast"))
  const governanceItems = createMemo(() => extractSection(props.initialPrompt || "", "Governance Hints"))
  const deltaItems = createMemo(() => extractSection(props.initialPrompt || "", "Contract Delta"))
  const impactItems = createMemo(() => extractKeyedItems(props.initialPrompt || "", "Repo Impact"))
  const unknownItems = createMemo(() => extractSection(props.initialPrompt || "", "Unknowns & Assumptions"))
  const watchoutItems = createMemo(() => extractSection(props.initialPrompt || "", "Operator Watchouts"))
  const rollbackItems = createMemo(() => extractSection(props.initialPrompt || "", "Rollback & Recovery"))

  const submitRefinedPrompt = () => {
    const next = textareaRef?.plainText || ""
    props.onUpdate(next)
    props.onSubmit?.()
  }

  const syncTextareaValue = (next: string) => {
    if (!textareaRef || !next) return
    if (textareaRef.plainText === next) return
    textareaRef.setText(next)
  }

  const scheduleFocusToEnd = () => {
    if (focusTimer) clearTimeout(focusTimer)
    focusTimer = setTimeout(() => {
      const textarea = textareaRef
      if (!textarea) return
      try {
        textarea.focus()
        textarea.gotoLineEnd()
      } catch {
        // The pane may have unmounted between scheduling and execution.
      }
    }, 60)
  }

  createEffect(() => {
    const newValue = props.initialPrompt || ""
    if (textareaRef && newValue && textareaRef.plainText !== newValue) {
      syncTextareaValue(newValue)
      scheduleFocusToEnd()
    }
  })

  const hasContent = () => props.initialPrompt && props.initialPrompt.length > 10

  const focusTextarea = () => {
    setSkipRefocus(true)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          textareaRef?.focus()
        } catch {
          // The refine pane can be torn down while focus is being deferred.
        }
      })
    })
  }

  onCleanup(() => {
    if (focusTimer) clearTimeout(focusTimer)
    focusTimer = undefined
    textareaRef = undefined
  })

  useKeyboard((event) => {
    if (!textareaRef?.focused) return
    if (!isRefineSubmitKey(event)) return
    event.preventDefault()
    submitRefinedPrompt()
  })

  return (
    <box flexDirection="column" width="100%" height="100%" gap={1} onMouseDown={focusTextarea}>
      <box flexDirection="column" gap={0} paddingBottom={1} border={["bottom"]} borderColor={theme.border}>
        <text fg={theme.accent} bold>
          Refine
        </text>
        <text fg={theme.textMuted}>Preflight the execution contract before you send it</text>
        <Show when={hasContent()}>
          <text fg={theme.text}>Review the plan, targets, and checks, then press Enter to run it.</text>
        </Show>
        <Show when={!hasContent()}>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
            Create a refined contract from the current prompt.
          </text>
        </Show>
        <Show when={hasContent()}>
          <box flexDirection="row" gap={1} flexWrap="wrap" paddingTop={1}>
            <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
              <text fg={theme.textMuted}>
                context <span style={{ fg: theme.text }}>{contextCount()}</span>
              </text>
            </box>
            <Show when={targetCount() > 0}>
              <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                <text fg={theme.textMuted}>
                  targets <span style={{ fg: theme.text }}>{targetCount()}</span>
                </text>
              </box>
            </Show>
            <Show when={writesCount() > 0}>
              <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                <text fg={theme.textMuted}>
                  writes <span style={{ fg: theme.text }}>{writesCount()}</span>
                </text>
              </box>
            </Show>
            <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
              <text fg={theme.textMuted}>
                plan <span style={{ fg: theme.text }}>{planCount()}</span>
              </text>
            </box>
            <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
              <text fg={theme.textMuted}>
                checks <span style={{ fg: theme.text }}>{successCount()}</span>
              </text>
            </box>
            <Show when={validationCount() > 0}>
              <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                <text fg={theme.textMuted}>
                  verify <span style={{ fg: theme.text }}>{validationCount()}</span>
                </text>
              </box>
            </Show>
            <Show when={approvalCount() > 0}>
              <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                <text fg={theme.warning}>
                  approvals <span style={{ fg: theme.text }}>{approvalCount()}</span>
                </text>
              </box>
            </Show>
            <Show when={governanceCount() > 0}>
              <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                <text fg={theme.warning}>
                  governance <span style={{ fg: theme.text }}>{governanceCount()}</span>
                </text>
              </box>
            </Show>
            <Show when={deltaCount() > 0}>
              <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                <text fg={theme.accent}>
                  delta <span style={{ fg: theme.text }}>{deltaCount()}</span>
                </text>
              </box>
            </Show>
            <Show when={impactCount() > 0}>
              <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                <text fg={theme.primary}>
                  impact <span style={{ fg: theme.text }}>{impactCount()}</span>
                </text>
              </box>
            </Show>
            <Show when={unknownCount() > 0}>
              <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                <text fg={theme.warning}>
                  unknowns <span style={{ fg: theme.text }}>{unknownCount()}</span>
                </text>
              </box>
            </Show>
            <Show when={watchoutCount() > 0}>
              <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                <text fg={theme.warning}>
                  watchouts <span style={{ fg: theme.text }}>{watchoutCount()}</span>
                </text>
              </box>
            </Show>
            <Show when={validationPlanCount() > 0}>
              <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                <text fg={theme.accent}>
                  staged validation <span style={{ fg: theme.text }}>{validationPlanCount()}</span>
                </text>
              </box>
            </Show>
          </box>
        </Show>
      </box>

      <Show when={hasContent()}>
        <box
          flexDirection="column"
          gap={1}
          border={["round"]}
          borderColor={theme.borderSubtle}
          backgroundColor={theme.backgroundElement}
          padding={1}
        >
          <Show when={goalText()}>
            <box flexDirection="column" gap={0}>
              <text fg={theme.textMuted}>Objective</text>
              <text fg={theme.text} wrapMode="word">
                {goalText()}
              </text>
            </box>
          </Show>

          <Show when={executionProfile().length > 0}>
            <box flexDirection="column" gap={0}>
              <text fg={theme.textMuted}>Execution profile</text>
              <For each={executionProfile()}>
                {(item, i) => <text fg={i() === 0 ? theme.accent : theme.text}>• {item}</text>}
              </For>
            </box>
          </Show>

          <Show when={contextItems().length > 0}>
            <box flexDirection="column" gap={0}>
              <text fg={theme.textMuted}>Context signals</text>
              <For each={contextItems().slice(0, 3)}>
                {(item) => <text fg={theme.text}>• {item}</text>}
              </For>
            </box>
          </Show>

          <Show when={targetItems().length > 0 || impactItems().length > 0}>
            <box flexDirection="column" gap={0}>
              <text fg={theme.textMuted}>Repo impact</text>
              <For each={targetItems().slice(0, 3)}>
                {(item) => <text fg={theme.accent}>→ {item}</text>}
              </For>
              <For each={impactItems().slice(0, 3)}>
                {(item) => (
                  <text fg={theme.text}>
                    {item.label ? `${item.label}: ` : ""}{item.value}
                  </text>
                )}
              </For>
            </box>
          </Show>

          <Show when={writeItems().length > 0 || deltaItems().length > 0}>
            <box flexDirection="column" gap={0}>
              <text fg={theme.textMuted}>Write scope and delta</text>
              <For each={writeItems().slice(0, 3)}>
                {(item) => <text fg={theme.primary}>✎ {item}</text>}
              </For>
              <For each={deltaItems().slice(0, 3)}>
                {(item) => <text fg={theme.text}>• {item}</text>}
              </For>
            </box>
          </Show>

          <Show when={planItems().length > 0}>
            <box flexDirection="column" gap={0}>
              <text fg={theme.textMuted}>Execution ladder</text>
              <For each={planItems().slice(0, 4)}>
                {(item, i) => <text fg={i() === 0 ? theme.primary : theme.text}>{i() === 0 ? "●" : "◌"} {item}</text>}
              </For>
            </box>
          </Show>

          <Show
            when={
              successItems().length > 0 ||
              validationItems().length > 0 ||
              validationPreflight().length > 0 ||
              validationPostChange().length > 0 ||
              validationShipReadiness().length > 0 ||
              approvalItems().length > 0 ||
              governanceItems().length > 0 ||
              unknownItems().length > 0 ||
              watchoutItems().length > 0 ||
              rollbackItems().length > 0
            }
          >
            <box flexDirection="row" gap={2} flexWrap="wrap">
              <Show when={successItems().length > 0}>
                <box flexDirection="column" gap={0}>
                  <text fg={theme.textMuted}>Checks</text>
                  <For each={successItems().slice(0, 3)}>
                    {(item) => <text fg={theme.success}>✓ {item}</text>}
                  </For>
                </box>
              </Show>
              <Show when={validationItems().length > 0}>
                <box flexDirection="column" gap={0}>
                  <text fg={theme.textMuted}>Validation</text>
                  <For each={validationItems().slice(0, 3)}>
                    {(item) => <text fg={theme.accent}>▸ {item}</text>}
                  </For>
                </box>
              </Show>
              <Show
                when={
                  validationPreflight().length > 0 ||
                  validationPostChange().length > 0 ||
                  validationShipReadiness().length > 0
                }
              >
                <box flexDirection="column" gap={0}>
                  <text fg={theme.textMuted}>Validation stages</text>
                  <For each={validationPreflight().slice(0, 2)}>
                    {(item) => <text fg={theme.text}>• preflight: {item}</text>}
                  </For>
                  <For each={validationPostChange().slice(0, 2)}>
                    {(item) => <text fg={theme.text}>• post-change: {item}</text>}
                  </For>
                  <For each={validationShipReadiness().slice(0, 2)}>
                    {(item) => <text fg={theme.text}>• ship: {item}</text>}
                  </For>
                </box>
              </Show>
              <Show when={approvalItems().length > 0}>
                <box flexDirection="column" gap={0}>
                  <text fg={theme.warning}>Approval forecast</text>
                  <For each={approvalItems().slice(0, 3)}>
                    {(item) => <text fg={theme.text}>⏸ {item}</text>}
                  </For>
                </box>
              </Show>
              <Show when={governanceItems().length > 0}>
                <box flexDirection="column" gap={0}>
                  <text fg={theme.warning}>Governance hints</text>
                  <For each={governanceItems().slice(0, 3)}>
                    {(item) => <text fg={theme.text}>⚑ {item}</text>}
                  </For>
                </box>
              </Show>
              <Show when={unknownItems().length > 0}>
                <box flexDirection="column" gap={0}>
                  <text fg={theme.warning}>Unknowns</text>
                  <For each={unknownItems().slice(0, 3)}>
                    {(item) => <text fg={theme.text}>? {item}</text>}
                  </For>
                </box>
              </Show>
              <Show when={watchoutItems().length > 0}>
                <box flexDirection="column" gap={0}>
                  <text fg={theme.warning}>Watchouts</text>
                  <For each={watchoutItems().slice(0, 3)}>
                    {(item) => <text fg={theme.text}>⚠ {item}</text>}
                  </For>
                </box>
              </Show>
              <Show when={rollbackItems().length > 0}>
                <box flexDirection="column" gap={0}>
                  <text fg={theme.textMuted}>Recovery</text>
                  <For each={rollbackItems().slice(0, 2)}>
                    {(item) => <text fg={theme.text}>↺ {item}</text>}
                  </For>
                </box>
              </Show>
            </box>
          </Show>
        </box>
      </Show>

      <box
        flexGrow={1}
        flexDirection="column"
        marginTop={1}
        border={["all"]}
        borderColor={hasContent() ? theme.success : theme.border}
        padding={1}
        onMouseDown={focusTextarea}
      >
        <textarea
          ref={(r: TextareaRenderable) => {
            textareaRef = r
            if (r && props.initialPrompt) {
              syncTextareaValue(props.initialPrompt)
            }
            scheduleFocusToEnd()
          }}
          initialValue={props.initialPrompt}
          onContentChange={(e: any) => {
            // Pass changes back to parent
            props.onUpdate(e.plainText || "")
          }}
          onMouseDown={focusTextarea}
          onSubmit={submitRefinedPrompt}
          textColor={theme.text}
          focusedTextColor={theme.text}
          backgroundColor={theme.backgroundElement}
          focusedBackgroundColor={theme.backgroundElement}
          cursorColor={theme.primary}
          flexGrow={1}
          keyBindings={[
            ...textareaKeybindings(),
            { name: "return", action: "submit" },
            { name: "linefeed", action: "submit" },
            { name: "enter", action: "submit" },
            { name: "return", shift: true, action: "newline" },
          ]}
        />
      </box>

      <box paddingTop={1} border={["top"]} borderColor={theme.border}>
        <text fg={theme.textMuted}>
          Tighten the scope, writes, approvals, checks, and recovery plan, then press Enter to continue.
        </text>
      </box>
    </box>
  )
}

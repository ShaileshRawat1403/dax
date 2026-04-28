import { useTheme, tint } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import { createSignal, Show, For, createMemo } from "solid-js"

type OperatorTab = "instructions" | "controls" | "context" | "session" | "commands"
type OperatorControlKey = keyof typeof CONTROL_OPTIONS

const OPERATOR_TABS: OperatorTab[] = ["instructions", "controls", "context", "session", "commands"]

const INSTRUCTION_TEMPLATES = [
  { label: "/perf", description: "optimize for performance" },
  { label: "/types", description: "prioritize type safety" },
  { label: "/test", description: "include test coverage" },
  { label: "/docs", description: "document as you go" },
  { label: "/bun", description: "use bun over npm" },
  { label: "/strict", description: "strict type checking" },
]

const CONTROL_OPTIONS = {
  speed: ["fast", "balanced", "safe"],
  verbosity: ["terse", "balanced", "rich"],
  risk: ["conservative", "balanced", "aggressive"],
  approval: ["minimal", "normal", "strict"],
}

function readInputValue(event: unknown) {
  if (typeof event === "string") return event
  if (typeof (event as { currentTarget?: { value?: unknown } })?.currentTarget?.value === "string") {
    return (event as { currentTarget: { value: string } }).currentTarget.value
  }
  if (typeof (event as { target?: { value?: unknown } })?.target?.value === "string") {
    return (event as { target: { value: string } }).target.value
  }
  if (typeof (event as { value?: unknown })?.value === "string") {
    return (event as { value: string }).value
  }
  return ""
}

export function OperatorPane(props: {
  instruction?: string
  onInstructionChange?: (value: string) => void
  onApplyOnce?: () => void
  onApplySession?: () => void
  onClear?: () => void
  controls?: Partial<Record<OperatorControlKey, string>>
  onControlChange?: (key: OperatorControlKey, value: string) => void
  contextUsage?: number
  stepsUsed?: number
  stepsTotal?: number
  pmRulesCount?: number
  branchName?: string
  sessionDuration?: string
  sessionTag?: string
  onSessionTagChange?: (value: string) => void
  onCommand?: (command: "/clear" | "/export" | "/fork" | "/help") => void
}) {
  const { theme } = useTheme()
  const [activeTab, setActiveTab] = createSignal<OperatorTab>("instructions")
  const [instructionScope, setInstructionScope] = createSignal<"once" | "session">("session")

  const contextPercent = createMemo(() => Math.round(props.contextUsage ?? 0))

  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" gap={1}>
      {/* Tab Navigation */}
      <box
        flexDirection="row"
        gap={1}
        alignItems="center"
        border={["bottom"]}
        borderColor={theme.borderSubtle}
        paddingBottom={1}
      >
        <For each={OPERATOR_TABS}>
          {(tab) => (
            <box
              onMouseUp={() => setActiveTab(() => tab)}
              paddingLeft={1}
              paddingRight={1}
              border={["round"]}
              borderColor={activeTab() === tab ? theme.borderActive : theme.borderSubtle}
              backgroundColor={
                activeTab() === tab ? tint(theme.backgroundElement, theme.primary, 0.16) : theme.backgroundElement
              }
            >
              <text
                fg={activeTab() === tab ? theme.primary : theme.textMuted}
                attributes={activeTab() === tab ? TextAttributes.BOLD : undefined}
              >
                {tab.slice(0, 4)}
              </text>
            </box>
          )}
        </For>
      </box>

      {/* Tab Content */}
      <Show when={activeTab() === "instructions"}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.textMuted} bold>
            Instruction:
          </text>
          <box
            flexDirection="row"
            gap={1}
            alignItems="center"
            border={["round"]}
            borderColor={theme.borderSubtle}
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg={theme.textMuted}>{">"}</text>
            <input
              flexGrow={1}
              backgroundColor="transparent"
              borderColor="transparent"
              fg={theme.text}
              placeholder="Enter instruction..."
              value={props.instruction ?? ""}
              onInput={(event: unknown) => props.onInstructionChange?.(readInputValue(event))}
            />
          </box>

          <box flexDirection="row" gap={2}>
            <box flexDirection="row" gap={1} alignItems="center">
              <box
                onMouseUp={() => setInstructionScope(() => "once")}
                border={["round"]}
                borderColor={instructionScope() === "once" ? theme.primary : theme.borderSubtle}
                paddingLeft={0.5}
                paddingRight={0.5}
              >
                <text fg={instructionScope() === "once" ? theme.primary : theme.textMuted} fontSize={0.8}>
                  ○ Once
                </text>
              </box>
              <box
                onMouseUp={() => setInstructionScope(() => "session")}
                border={["round"]}
                borderColor={instructionScope() === "session" ? theme.primary : theme.borderSubtle}
                paddingLeft={0.5}
                paddingRight={0.5}
              >
                <text fg={instructionScope() === "session" ? theme.primary : theme.textMuted} fontSize={0.8}>
                  ● Session
                </text>
              </box>
            </box>
          </box>

          <text fg={theme.textMuted} bold marginTop={1}>
            Templates:
          </text>
          <box flexDirection="row" gap={1} flexWrap="wrap">
            <For each={INSTRUCTION_TEMPLATES}>
              {(template) => (
                <box
                  onMouseUp={() => props.onInstructionChange?.(template.description)}
                  border={["round"]}
                  borderColor={theme.borderSubtle}
                  paddingLeft={0.5}
                  paddingRight={0.5}
                >
                  <text fg={theme.primary} fontSize={0.85}>
                    {template.label}
                  </text>
                </box>
              )}
            </For>
          </box>

          <box flexDirection="row" gap={1} marginTop={1}>
            <box
              onMouseUp={() => {
                if (instructionScope() === "once") props.onApplyOnce?.()
                else props.onApplySession?.()
              }}
              border={["round"]}
              borderColor={theme.primary}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={theme.primary} fontSize={0.85}>
                {instructionScope() === "once" ? "APPLY ONCE" : "USE EACH TURN"}
              </text>
            </box>
            <box
              onMouseUp={() => {
                props.onClear?.()
                props.onInstructionChange?.("")
              }}
              border={["round"]}
              borderColor={theme.warning}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={theme.warning} fontSize={0.85}>
                CLEAR
              </text>
            </box>
          </box>
        </box>
      </Show>

      <Show when={activeTab() === "controls"}>
        <box flexDirection="column" gap={1.5}>
          <For each={Object.entries(CONTROL_OPTIONS)}>
            {([key, options]) => (
              <box flexDirection="column" gap={0.5}>
                <text fg={theme.textMuted} fontSize={0.85} bold>
                  {key.toUpperCase()}
                </text>
                <box flexDirection="row" gap={0.5}>
                  <For each={options}>
                    {(option) => (
                      <box
                        onMouseUp={() => props.onControlChange?.(key as OperatorControlKey, option)}
                        border={["round"]}
                        borderColor={
                          props.controls?.[key as OperatorControlKey] === option ? theme.primary : theme.borderSubtle
                        }
                        backgroundColor={
                          props.controls?.[key as OperatorControlKey] === option
                            ? tint(theme.backgroundElement, theme.primary, 0.16)
                            : undefined
                        }
                        paddingLeft={0.5}
                        paddingRight={0.5}
                      >
                        <text
                          fg={
                            props.controls?.[key as OperatorControlKey] === option ? theme.primary : theme.textMuted
                          }
                          fontSize={0.8}
                        >
                          {option}
                        </text>
                      </box>
                    )}
                  </For>
                </box>
              </box>
            )}
          </For>
        </box>
      </Show>

      <Show when={activeTab() === "context"}>
        <box flexDirection="column" gap={1}>
          <box flexDirection="row" justifyContent="space-between" alignItems="center">
            <text fg={theme.textMuted} fontSize={0.85}>
              Context
            </text>
            <text fg={theme.primary} fontSize={0.85}>
              {contextPercent()}%
            </text>
          </box>
          <box width="100%" height={2} backgroundColor={theme.backgroundElement}>
            <box
              width={`${contextPercent()}%`}
              height={2}
              backgroundColor={contextPercent() > 80 ? theme.warning : theme.primary}
            />
          </box>

          <box flexDirection="row" justifyContent="space-between" alignItems="center" marginTop={1}>
            <text fg={theme.textMuted} fontSize={0.85}>
              Steps
            </text>
            <text fg={theme.secondary} fontSize={0.85}>
              {props.stepsUsed ?? 0}/{props.stepsTotal ?? 24}
            </text>
          </box>
          <box width="100%" height={2} backgroundColor={theme.backgroundElement}>
            <box
              width={`${((props.stepsUsed ?? 0) / (props.stepsTotal ?? 24)) * 100}%`}
              height={2}
              backgroundColor={theme.secondary}
            />
          </box>

          <box flexDirection="column" gap={0.5} marginTop={1}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.textMuted} fontSize={0.8}>
                PM Rules
              </text>
              <text fg={theme.text} fontSize={0.8}>
                {props.pmRulesCount ?? 0}
              </text>
            </box>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.textMuted} fontSize={0.8}>
                Branch
              </text>
              <text fg={theme.text} fontSize={0.8}>
                {props.branchName ?? "main"}
              </text>
            </box>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.textMuted} fontSize={0.8}>
                Duration
              </text>
              <text fg={theme.text} fontSize={0.8}>
                {props.sessionDuration ?? "0m"}
              </text>
            </box>
          </box>
        </box>
      </Show>

      <Show when={activeTab() === "session"}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.textMuted} fontSize={0.85} bold>
            Session Tag:
          </text>
          <box
            flexDirection="row"
            gap={1}
            alignItems="center"
            border={["round"]}
            borderColor={theme.borderSubtle}
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg={theme.primary}>#</text>
            <input
              flexGrow={1}
              backgroundColor="transparent"
              borderColor="transparent"
              fg={theme.text}
              placeholder="feature, bugfix, refactor..."
              value={props.sessionTag ?? ""}
              onInput={(event: unknown) => props.onSessionTagChange?.(readInputValue(event))}
            />
          </box>

          <text fg={theme.textMuted} fontSize={0.85} bold marginTop={1}>
            Quick Tags:
          </text>
          <box flexDirection="row" gap={1} flexWrap="wrap">
            <For each={["#feature", "#bugfix", "#refactor", "#explore", "#docs", "#fix"]}>
              {(tag) => (
                <box
                  onMouseUp={() => props.onSessionTagChange?.(tag)}
                  border={["round"]}
                  borderColor={theme.borderSubtle}
                  paddingLeft={0.5}
                  paddingRight={0.5}
                >
                  <text fg={theme.textMuted} fontSize={0.85}>
                    {tag}
                  </text>
                </box>
              )}
            </For>
          </box>
        </box>
      </Show>

      <Show when={activeTab() === "commands"}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.textMuted} fontSize={0.85}>
            Quick Commands
          </text>
          <box flexDirection="column" gap={0.5}>
            <For each={["/clear", "/export", "/fork", "/help"]}>
              {(cmd) => (
                <box flexDirection="row" gap={1} alignItems="center" onMouseUp={() => props.onCommand?.(cmd as any)}>
                  <text fg={theme.primary} fontSize={0.9} attributes={TextAttributes.BOLD}>
                    {cmd}
                  </text>
                  <text fg={theme.textMuted} fontSize={0.8}>
                    run
                  </text>
                </box>
              )}
            </For>
          </box>
        </box>
      </Show>
    </box>
  )
}

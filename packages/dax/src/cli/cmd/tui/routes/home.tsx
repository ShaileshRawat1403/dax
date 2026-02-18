import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { tint, useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import { Logo } from "../component/logo"
import { Tips } from "../component/tips"
import { Locale } from "@/util/locale"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useDirectory } from "../context/directory"
import { useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { Installation } from "@/installation"
import { useKV } from "../context/kv"
import { useCommandDialog } from "../component/dialog-command"
import { useTerminalDimensions } from "@opentui/solid"
import { cpus, freemem, totalmem } from "node:os"

const STAGES = ["Understand", "Discovery", "Analysis", "Plan", "Audit", "Execute", "Verify"]
const STAGES_ELI12 = ["Understand", "Find", "Think", "Plan", "Safety", "Do", "Check"]
const HERO = "Deterministic AI Execution"
const LIVE_FRAMES = ["◎", "◉", "⬤", "◉"]
const FEED_FRAMES = ["●○○", "○●○", "○○●", "○●○"]

// TODO: what is the best way to do this?
let once = false

export function Home() {
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const command = useCommandDialog()
  const dimensions = useTerminalDimensions()
  const mcp = createMemo(() => Object.keys(sync.data.mcp).length > 0)
  const mcpError = createMemo(() => {
    return Object.values(sync.data.mcp).some((x) => x.status === "failed")
  })

  const connectedMcpCount = createMemo(() => {
    return Object.values(sync.data.mcp).filter((x) => x.status === "connected").length
  })

  const isFirstTimeUser = createMemo(() => sync.data.session.length === 0)
  const tipsHidden = createMemo(() => kv.get("tips_hidden", true))
  const showTips = createMemo(() => {
    // Don't show tips for first-time users
    if (isFirstTimeUser()) return false
    return !tipsHidden()
  })
  const explainMode = createMemo(() => kv.get("explain_mode", "normal") === "eli12")
  const stages = createMemo(() => (explainMode() ? STAGES_ELI12 : STAGES))

  command.register(() => [
    {
      title: tipsHidden() ? "Show tips" : "Hide tips",
      value: "tips.toggle",
      keybind: "tips_toggle",
      category: "System",
      onSelect: (dialog) => {
        kv.set("tips_hidden", !tipsHidden())
        dialog.clear()
      },
    },
    {
      title: explainMode() ? "Disable ELI12 mode" : "Enable ELI12 mode",
      value: "eli12.toggle",
      category: "System",
      onSelect: (dialog) => {
        kv.set("explain_mode", explainMode() ? "normal" : "eli12")
        dialog.clear()
      },
    },
  ])

  const Hint = (
    <Show when={connectedMcpCount() > 0}>
      <box flexShrink={0} flexDirection="row" gap={1}>
        <text fg={theme.text}>
          <Switch>
            <Match when={mcpError()}>
              <span style={{ fg: theme.error }}>•</span> mcp errors{" "}
              <span style={{ fg: theme.textMuted }}>ctrl+x s</span>
            </Match>
            <Match when={true}>
              <span style={{ fg: theme.success }}>•</span>{" "}
              {Locale.pluralize(connectedMcpCount(), "{} mcp server", "{} mcp servers")}
            </Match>
          </Switch>
        </text>
      </box>
    </Show>
  )

  let prompt: PromptRef
  const args = useArgs()
  onMount(() => {
    if (once) return
    if (route.initialPrompt) {
      prompt.set(route.initialPrompt)
      once = true
    } else if (args.prompt) {
      prompt.set({ input: args.prompt, parts: [] })
      once = true
      prompt.submit()
    }
  })
  const directory = useDirectory()

  const wide = createMemo(() => dimensions().width >= 112)
  const compact = createMemo(() => dimensions().width < 92)
  const minimal = createMemo(() => dimensions().width < 80 || dimensions().height < 28)
  const shell = createMemo(() => tint(theme.background, theme.text, 0.01))
  const frame = createMemo(() => tint(theme.background, theme.text, 0.04))
  const hero = createMemo(() => tint(theme.background, theme.primary, 0.09))
  const inputPanel = createMemo(() => tint(theme.background, theme.text, 0.03))
  const livePanel = createMemo(() => tint(theme.background, theme.secondary, 0.12))
  const [telemetry, setTelemetry] = createSignal({
    cpu: 0,
    ram: 0,
    gpu: 0,
    ramUsed: 0,
    ramTotal: 0,
    tick: 0,
    gpuLabel: process.platform === "darwin" ? "Unified" : "GPU",
    gpuText: process.platform === "darwin" ? "" : "n/a",
  })

  const cpuSnap = () =>
    cpus().reduce(
      (acc, item) => {
        const total = item.times.user + item.times.nice + item.times.sys + item.times.idle + item.times.irq
        return { idle: acc.idle + item.times.idle, total: acc.total + total }
      },
      { idle: 0, total: 0 },
    )

  const feed = createMemo(() => FEED_FRAMES[telemetry().tick % FEED_FRAMES.length])
  const live = createMemo(() => LIVE_FRAMES[telemetry().tick % LIVE_FRAMES.length])

  onMount(() => {
    let prev = cpuSnap()
    const timer = setInterval(() => {
      const next = cpuSnap()
      const totalDiff = next.total - prev.total
      const idleDiff = next.idle - prev.idle
      prev = next
      const cpu = totalDiff > 0 ? Math.max(0, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 100))) : 0
      const ramTotal = totalmem()
      const ramUsed = ramTotal - freemem()
      const ram = ramTotal > 0 ? Math.max(0, Math.min(100, Math.round((ramUsed / ramTotal) * 100))) : 0
      const gpu = process.platform === "darwin" ? ram : 0
      setTelemetry((current) => ({
        ...current,
        cpu,
        ram,
        gpu,
        ramUsed,
        ramTotal,
        gpuText: process.platform === "darwin" ? `${(ramUsed / 1024 / 1024 / 1024).toFixed(1)} / ${(ramTotal / 1024 / 1024 / 1024).toFixed(1)} GB` : "n/a",
        tick: current.tick + 1,
      }))
    }, 1000)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <>
      <box
        flexGrow={1}
        justifyContent="center"
        alignItems="center"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        gap={1}
        backgroundColor={shell()}
      >
        <box
          width="100%"
          maxWidth={104}
          alignItems="center"
          gap={1}
          backgroundColor={frame()}
          border={["top", "right", "bottom", "left"]}
          borderColor={theme.borderSubtle}
          padding={2}
        >
          <box
            width="100%"
            alignItems="center"
            backgroundColor={hero()}
            border={["top", "right", "bottom", "left"]}
            borderColor={theme.border}
            paddingTop={1}
            paddingBottom={1}
          >
            <Logo />
            <text fg={theme.accent} attributes={TextAttributes.BOLD}>
              {HERO}
            </text>
            <text fg={theme.textMuted}>AI-assisted, not AI-generated</text>
            <text fg={explainMode() ? theme.success : theme.textMuted}>
              ELI12 {explainMode() ? "on" : "off"} {explainMode() ? "· plain language mode" : ""}
            </text>
          </box>
          <box width="100%" maxWidth={94} flexDirection={wide() ? "row" : "column"} gap={1} alignItems="stretch">
            <box
              flexGrow={1}
              backgroundColor={inputPanel()}
              border={["top", "right", "bottom", "left"]}
              borderColor={theme.borderSubtle}
              padding={1}
              zIndex={1000}
            >
              <Prompt
                ref={(r) => {
                  prompt = r
                  promptRef.set(r)
                }}
                hint={Hint}
              />
            </box>
            <Show when={!minimal()}>
              <box
                width={wide() ? 36 : "100%"}
                backgroundColor={livePanel()}
                border={["top", "right", "bottom", "left"]}
                borderColor={theme.border}
                paddingLeft={1}
                paddingRight={1}
                paddingTop={1}
                paddingBottom={1}
                justifyContent="center"
              >
                <text fg={theme.warning} attributes={TextAttributes.BOLD}>
                  Live System Feed <span style={{ fg: theme.accent }}>{feed()}</span>
                </text>
                <text fg={theme.text}>
                  <span style={{ fg: theme.success }}>{live()}</span>{" "}
                  <span style={{ fg: theme.primary }}>[CPU {String(telemetry().cpu).padStart(2)}]</span>{" "}
                  <span style={{ fg: theme.accent }}>[RAM {String(telemetry().ram).padStart(2)}]</span>{" "}
                  <span style={{ fg: theme.secondary }}>
                    [{telemetry().gpuLabel.toUpperCase()} {String(telemetry().gpu).padStart(2)}]
                  </span>{" "}
                  <span style={{ fg: theme.textMuted }}>
                    [MEM {(telemetry().ramUsed / 1024 / 1024 / 1024).toFixed(1)}/{(telemetry().ramTotal / 1024 / 1024 / 1024).toFixed(1)}G]
                  </span>
                </text>
              </box>
            </Show>
          </box>
          <box flexDirection={compact() ? "column" : "row"} gap={1} paddingTop={1} alignItems="center" justifyContent="center">
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              {explainMode() ? "Simple steps" : "Lifecycle"}
            </text>
            <For each={stages()}>
              {(stage, index) => (
                <box flexDirection="row" gap={1}>
                  <text fg={index() < 2 ? theme.primary : theme.textMuted}>{stage}</text>
                  <Show when={index() !== stages().length - 1}>
                    <text fg={theme.borderSubtle}>·</text>
                  </Show>
                </box>
              )}
            </For>
          </box>
          <Show when={showTips() && !minimal()}>
            <box height={1} width="100%" maxWidth={76} alignItems="center" paddingTop={1}>
              <Tips />
            </box>
          </Show>
        </box>
        <Toast />
      </box>
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexDirection="row" flexShrink={0} gap={2}>
        <text fg={theme.textMuted}>{directory()}</text>
        <box gap={1} flexDirection="row" flexShrink={0}>
          <Show when={mcp()}>
            <text fg={theme.text}>
              <Switch>
                <Match when={mcpError()}>
                  <span style={{ fg: theme.error }}>⊙ </span>
                </Match>
                <Match when={true}>
                  <span style={{ fg: connectedMcpCount() > 0 ? theme.success : theme.textMuted }}>⊙ </span>
                </Match>
              </Switch>
              {connectedMcpCount()} MCP
            </text>
            <text fg={theme.textMuted}>/status</text>
          </Show>
        </box>
        <box flexGrow={1} />
        <box flexShrink={0}>
          <text fg={theme.textMuted}>{Installation.VERSION}</text>
        </box>
      </box>
    </>
  )
}

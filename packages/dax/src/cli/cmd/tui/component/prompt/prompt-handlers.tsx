import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useLocal } from "@tui/context/local"
import { useKV } from "../../context/kv"
import { useToast } from "../../ui/toast"
import { useExit } from "../../context/exit"
import { usePromptHistory, type PromptInfo } from "./history"
import { useCommandDialog } from "../dialog-command"
import { Log } from "@/util/log"
import { DAX_SETTING } from "@/dax/settings"
import { refineIntent } from "@/intent/interpret"
import { produce } from "solid-js/store"
import { Identifier } from "@/id/id"
import { iife } from "@/util/iife"
import { Clipboard } from "@tui/util/clipboard"
import type { TextareaRenderable, KeyEvent, PasteEvent } from "@opentui/core"
import type { AutocompleteRef } from "./autocomplete"
import type { PromptProps } from "./index"
import { ELI12_PREFIX, ELI12_TEMPLATE_RE, WORKFLOW_MODES } from "./prompt-state"
import { batch } from "solid-js"
import { useKeybind } from "@tui/context/keybind"
import type { FilePart } from "@dax-ai/sdk/v2"
import { useRenderer } from "@opentui/solid"
import { useDialog } from "@tui/ui/dialog"
import { DialogProvider as DialogProviderConnect } from "../dialog-provider"

export function usePromptHandlers(
  props: PromptProps,
  state: ReturnType<typeof import("./prompt-state").usePromptState>,
  refs: {
    input: () => TextareaRenderable | undefined
    autocomplete: () => AutocompleteRef | undefined
    promptPartTypeId: () => number
    pasteStyleId: () => number
    fileStyleId: () => number
    agentStyleId: () => number
  },
) {
  const sdk = useSDK()
  const route = useRoute()
  const sync = useSync()
  const local = useLocal()
  const kv = useKV()
  const toast = useToast()
  const exit = useExit()
  const history = usePromptHistory()
  const command = useCommandDialog()
  const keybind = useKeybind()
  const log = Log.create({ service: "tui.prompt" })
  const renderer = useRenderer()
  const dialog = useDialog()

  const { store, setStore } = state

  function restoreExtmarksFromParts(parts: PromptInfo["parts"]) {
    const input = refs.input()
    if (!input || input.isDestroyed) return
    input.extmarks.clear()
    setStore("extmarkToPartIndex", new Map())

    parts.forEach((part, partIndex) => {
      let start = 0
      let end = 0
      let virtualText = ""
      let styleId: number | undefined

      if (part.type === "file" && part.source?.text) {
        start = part.source.text.start
        end = part.source.text.end
        virtualText = part.source.text.value
        styleId = refs.fileStyleId()
      } else if (part.type === "agent" && part.source) {
        start = part.source.start
        end = part.source.end
        virtualText = part.source.value
        styleId = refs.agentStyleId()
      } else if (part.type === "text" && part.source?.text) {
        start = part.source.text.start
        end = part.source.text.end
        virtualText = part.source.text.value
        styleId = refs.pasteStyleId()
      }

      if (virtualText) {
        const extmarkId = input.extmarks.create({
          start,
          end,
          virtual: true,
          styleId,
          typeId: refs.promptPartTypeId(),
        })
        setStore("extmarkToPartIndex", (map: Map<number, number>) => {
          const newMap = new Map(map)
          newMap.set(extmarkId, partIndex)
          return newMap
        })
      }
    })
  }

  function syncExtmarksWithPromptParts() {
    const input = refs.input()
    if (!input || input.isDestroyed) return
    const allExtmarks = input.extmarks.getAllForTypeId(refs.promptPartTypeId())
    setStore(
      produce((draft) => {
        const newMap = new Map<number, number>()
        const newParts: typeof draft.prompt.parts = []

        for (const extmark of allExtmarks) {
          const partIndex = draft.extmarkToPartIndex.get(extmark.id)
          if (partIndex !== undefined) {
            const part = draft.prompt.parts[partIndex]
            if (part) {
              if (part.type === "agent" && part.source) {
                part.source.start = extmark.start
                part.source.end = extmark.end
              } else if (part.type === "file" && part.source?.text) {
                part.source.text.start = extmark.start
                part.source.text.end = extmark.end
              } else if (part.type === "text" && part.source?.text) {
                part.source.text.start = extmark.start
                part.source.text.end = extmark.end
              }
              newMap.set(extmark.id, newParts.length)
              newParts.push(part)
            }
          }
        }

        draft.extmarkToPartIndex = newMap
        draft.prompt.parts = newParts
      }),
    )
  }

  const setExplainMode = (enabled: boolean) => {
    state.setExplainMode(enabled)
    toast.show({
      variant: "info",
      message: enabled ? "ELI12 enabled: plain-language explanations on" : "ELI12 disabled: normal explanations on",
      duration: 2500,
    })
  }

  const clearPrompt = () => {
    const input = refs.input()
    if (input) {
      input.extmarks.clear()
      input.clear()
    }
    setStore("prompt", {
      input: "",
      parts: [],
    })
    setStore("extmarkToPartIndex", new Map())
  }

  const applyELI12Command = (text: string) => {
    if (!/^\/eli12(\s|$)/i.test(text)) return { handled: false as const }
    const stripped = text.replace(/^\/eli12\s*/i, "")
    const mode = stripped.split(/\s+/)[0]?.toLowerCase() || "toggle"
    if (mode === "on") {
      if (!state.explainMode()) setExplainMode(true)
      clearPrompt()
      return { handled: true as const }
    }
    if (mode === "off") {
      setExplainMode(false)
      clearPrompt()
      return { handled: true as const }
    }
    if (mode === "status") {
      toast.show({
        variant: "info",
        message: state.explainMode() ? "ELI12 is on" : "ELI12 is off",
        duration: 2000,
      })
      clearPrompt()
      return { handled: true as const }
    }
    if (mode === "toggle" || mode.length === 0) {
      if (!state.explainMode()) setExplainMode(true)
      const exact = /^\/eli12(\s+toggle)?$/i.test(text.trim())
      if (exact)
        return {
          handled: true as const,
          submitText: "Explain your previous response so a non-technical person can understand.",
        }

      const payload = stripped.trim()
      return {
        handled: true as const,
        submitText: `Please explain this:\n${payload}`,
      }
    }
    const payload = stripped.trim()
    if (!state.explainMode()) setExplainMode(true)
    return {
      handled: true as const,
      submitText: `Please explain this:\n${payload}`,
    }
  }

  function promptModelWarning() {
    toast.show({
      variant: "warning",
      message: "Connect OpenAI, Gemini, Anthropic, or Ollama to send prompts",
      duration: 3000,
    })
    if (sync.data.provider.length === 0) {
      dialog.replace(() => <DialogProviderConnect />)
    }
  }

  async function handleRefine() {
    if (props.disabled) {
      log.info("handleRefine: disabled")
      return
    }
    if (!store.prompt.input) {
      log.info("handleRefine: no input")
      toast.show({
        variant: "error",
        message: "Type a prompt first",
        duration: 2000,
      })
      return
    }

    const rawInput = store.prompt.input.trim()
    log.info("handleRefine: starting", { rawInput: rawInput.slice(0, 50) })

    toast.show({
      variant: "info",
      message: "Refining prompt...",
      duration: 1500,
    })

    try {
      const contract = await refineIntent(rawInput, {
        cwd: process.cwd(),
        session_id: props.sessionID,
        session_title: props.sessionID ? sync.session.get(props.sessionID)?.title : undefined,
        current_focus:
          state.status().type === "retry"
            ? "session is retrying"
            : state.status().type === "delayed"
              ? "waiting on provider response"
              : state.currentFocus(),
        todo: state
          .sessionTodos()
          .map((item: any) => item?.content)
          .filter(Boolean)
          .slice(0, 5),
        recent_history: state.recentHistory(),
        recent_activity: state.recentActivity(),
        recent_tools: state.recentTools(),
        pending_approvals: state.pendingPermissions(),
        pending_questions: state.pendingQuestions(),
      })

      log.info("handleRefine: got contract", { goal: contract?.goal })

      const refinedText =
        contract?.formattedPrompt ||
        [
          `## Goal`,
          contract?.goal || rawInput,
          "",
          "## Execution Plan",
          ...(contract?.executionPlan || []).map((s, i) => `${i + 1}. ${s}`),
          "",
          "## Success Criteria",
          ...(contract?.successCriteria || []).map((s) => `- ${s}`),
          "",
          "## Constraints & Requirements",
          ...(contract?.explicitConstraints || []).map((s) => `- ${s}`),
          "",
          "---",
          "Edit this contract above, then press Enter to execute.",
        ].join("\n")

      log.info("handleRefine: storing refined text", { length: refinedText.length })

      kv.set(DAX_SETTING.session_refined_prompt, refinedText)

      props.onRefineReady?.(refinedText)
      if (!props.onRefineReady) {
        kv.set(DAX_SETTING.session_pane_mode, "refine")
        kv.set(DAX_SETTING.session_pane_visibility, "pinned")
      }

      await new Promise((r) => setTimeout(r, 100))

      log.info("handleRefine: done, pane should show")

      toast.show({
        variant: "success",
        message: "Prompt refined!",
        duration: 2000,
      })
    } catch (e) {
      log.error("failed to refine prompt", { error: String(e) })
      toast.show({
        variant: "error",
        message: "Failed to refine prompt: " + String(e).slice(0, 50),
        duration: 3000,
      })
    }
  }

  function pasteText(text: string, virtualText: string) {
    const input = refs.input()
    if (!input || input.isDestroyed) return
    const currentOffset = input.visualCursor.offset
    const extmarkStart = currentOffset
    const extmarkEnd = extmarkStart + virtualText.length

    input.insertText(virtualText + " ")

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: refs.pasteStyleId(),
      typeId: refs.promptPartTypeId(),
    })

    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push({
          type: "text" as const,
          text,
          source: {
            text: {
              start: extmarkStart,
              end: extmarkEnd,
              value: virtualText,
            },
          },
        })
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
  }

  async function pasteImage(file: { filename?: string; content: string; mime: string }) {
    const input = refs.input()
    if (!input || input.isDestroyed) return
    const currentOffset = input.visualCursor.offset
    const extmarkStart = currentOffset
    const count = store.prompt.parts.filter((x) => x.type === "file").length
    const virtualText = `[Image ${count + 1}]`
    const extmarkEnd = extmarkStart + virtualText.length
    const textToInsert = virtualText + " "

    input.insertText(textToInsert)

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: refs.pasteStyleId(),
      typeId: refs.promptPartTypeId(),
    })

    const part: Omit<FilePart, "id" | "messageID" | "sessionID"> = {
      type: "file" as const,
      mime: file.mime,
      filename: file.filename,
      url: `data:${file.mime};base64,${file.content}`,
      source: {
        type: "file",
        path: file.filename ?? "",
        text: {
          start: extmarkStart,
          end: extmarkEnd,
          value: virtualText,
        },
      },
    }
    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push(part)
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
  }

  const resolveSubmitAgent = (text: string) => {
    return local.agent.current().name
  }

  async function submit() {
    const input = refs.input()
    const autocomplete = refs.autocomplete()
    if (!input || input.isDestroyed) return

    if (props.disabled) return
    if (autocomplete?.visible) return
    if (!store.prompt.input) return
    const trimmed = store.prompt.input.trim()
    if (trimmed === "exit" || trimmed === "quit" || trimmed === ":q") {
      exit()
      return
    }
    const eli12Command = applyELI12Command(trimmed)
    if (eli12Command.handled && !eli12Command.submitText) return
    const selectedModel = local.model.current()
    if (!selectedModel) {
      promptModelWarning()
      return
    }
    const sessionID = props.sessionID
      ? props.sessionID
      : await (async () => {
          const sessionID = await sdk.client.session.create({}).then((x) => x.data!.id)
          return sessionID
        })()
    const messageID = Identifier.ascending("message")

    let inputText = eli12Command.handled ? eli12Command.submitText! : store.prompt.input
    let inputSystem: string | undefined

    const allExtmarks = input.extmarks.getAllForTypeId(refs.promptPartTypeId())
    const sortedExtmarks = allExtmarks.sort((a: { start: number }, b: { start: number }) => b.start - a.start)

    for (const extmark of sortedExtmarks) {
      const partIndex = store.extmarkToPartIndex.get(extmark.id)
      if (partIndex !== undefined) {
        const part = store.prompt.parts[partIndex]
        if (part?.type === "text" && part.text) {
          const before = inputText.slice(0, extmark.start)
          const after = inputText.slice(extmark.end)
          inputText = before + part.text + after
        }
      }
    }

    if (ELI12_TEMPLATE_RE.test(inputText)) {
      if (!state.explainMode()) setExplainMode(true)
      inputText = inputText.replace(ELI12_TEMPLATE_RE, "").trim()
      if (!inputText) inputText = "Please help me with this in plain language."
    }

    const isSlashCommand =
      !eli12Command.handled &&
      inputText.startsWith("/") &&
      iife(() => {
        const firstLine = inputText.split("\n")[0]
        const cmd = firstLine.split(" ")[0].slice(1)
        return sync.data.command.some((x) => x.name === cmd)
      })

    if (!isSlashCommand) {
      if (state.explainMode() || eli12Command.handled) {
        inputSystem = ELI12_PREFIX
      }
    }

    const nonTextParts = store.prompt.parts.filter((part) => part.type !== "text")

    const currentMode = store.mode
    const variant = local.model.variant.current()
    const submitAgent = resolveSubmitAgent(inputText)

    if (store.mode === "shell") {
      sdk.client.session.shell({
        sessionID,
        agent: submitAgent,
        model: {
          providerID: selectedModel.providerID,
          modelID: selectedModel.modelID,
        },
        command: inputText,
      })
      setStore("mode", "normal")
    } else if (isSlashCommand) {
      const firstLineEnd = inputText.indexOf("\n")
      const firstLine = firstLineEnd === -1 ? inputText : inputText.slice(0, firstLineEnd)
      const [cmd, ...firstLineArgs] = firstLine.split(" ")
      const restOfInput = firstLineEnd === -1 ? "" : inputText.slice(firstLineEnd + 1)
      const args = firstLineArgs.join(" ") + (restOfInput ? "\n" + restOfInput : "")

      sdk.client.session.command({
        sessionID,
        command: cmd.slice(1),
        arguments: args,
        agent: submitAgent,
        model: `${selectedModel.providerID}/${selectedModel.modelID}`,
        messageID,
        variant,
        parts: nonTextParts
          .filter((x) => x.type === "file")
          .map((x) => ({
            id: Identifier.ascending("part"),
            ...x,
          })),
      })
    } else {
      sdk.client.session
        .prompt({
          sessionID,
          ...selectedModel,
          messageID,
          agent: submitAgent,
          model: selectedModel,
          variant,
          system: inputSystem,
          parts: [
            {
              id: Identifier.ascending("part"),
              type: "text",
              text: inputText,
            },
            ...nonTextParts.map((x) => ({
              id: Identifier.ascending("part"),
              ...x,
            })),
          ],
        })
        .catch(() => {})
    }
    history.append({
      ...store.prompt,
      mode: currentMode,
    })
    input.extmarks.clear()
    setStore("prompt", {
      input: "",
      parts: [],
    })
    setStore("extmarkToPartIndex", new Map())
    kv.set(DAX_SETTING.session_refined_prompt, "")
    props.onSubmit?.()

    if (!props.sessionID)
      setTimeout(() => {
        route.navigate({
          type: "session",
          sessionID,
        })
      }, 50)
    input.clear()
  }

  async function onKeyDown(e: KeyEvent) {
    const input = refs.input()
    const autocomplete = refs.autocomplete()
    if (!input || !autocomplete) return

    // Interrupt must bypass the disabled guard AND the command-enabled gate.
    // Routing through command.trigger() silently no-ops when enabled=false
    // (stale sync data race). Inline the logic so ESC always reaches the handler.
    if (keybind.match("session_interrupt", e)) {
      e.preventDefault()
      if (store.mode === "shell") {
        setStore("mode", "normal")
        return
      }
      if (refs.autocomplete()?.visible) return
      if (props.sessionID) {
        const next = store.interrupt + 1
        setStore("interrupt", next)
        setTimeout(() => setStore("interrupt", 0), 5000)
        if (next >= 2) {
          sdk.client.session.abort({ sessionID: props.sessionID })
          setStore("interrupt", 0)
          toast.show({ variant: "warning", message: "Session interrupted." })
        } else {
          toast.show({ variant: "warning", message: "Press ESC again to stop the session." })
        }
      }
      return
    }

    if (props.disabled) {
      e.preventDefault()
      return
    }
    if (e.name === "r" && e.ctrl) {
      e.preventDefault()
      handleRefine()
      return
    }

    if (
      state.isPanePinned() &&
      state.activePaneMode() === "approvals" &&
      state.pendingPermissions() + state.pendingQuestions() > 0
    ) {
      if ((e.name === "y" || e.name === "Y") && e.ctrl) {
        e.preventDefault()
        command.trigger("approvals.approve_current")
        return
      }
      if ((e.name === "n" || e.name === "N") && e.ctrl) {
        e.preventDefault()
        command.trigger("approvals.deny_current")
        return
      }
      if (e.name === "escape") {
        e.preventDefault()
        kv.set(DAX_SETTING.session_pane_visibility, "auto")
        return
      }
    }

    if (keybind.match("input_paste", e)) {
      const content = await Clipboard.read()
      if (content?.mime.startsWith("image/")) {
        e.preventDefault()
        await pasteImage({
          filename: "clipboard",
          mime: content.mime,
          content: content.data,
        })
        return
      }
    }

    if (keybind.match("input_clear", e) && store.prompt.input !== "") {
      input.clear()
      input.extmarks.clear()
      setStore("prompt", {
        input: "",
        parts: [],
      })
      setStore("extmarkToPartIndex", new Map())
      return
    }
    if (keybind.match("app_exit", e)) {
      if (store.prompt.input === "") {
        await exit()
        e.preventDefault()
        return
      }
    }
    if (e.name === "!" && input.visualCursor.offset === 0) {
      setStore("mode", "shell")
      e.preventDefault()
      return
    }
    if (store.mode === "shell") {
      if ((e.name === "backspace" && input.visualCursor.offset === 0) || e.name === "escape") {
        setStore("mode", "normal")
        e.preventDefault()
        return
      }
    }
    if (!autocomplete.visible) {
      let direction = 0
      if (e.name === "tab") {
        direction = e.shift ? -1 : 1
      } else if (keybind.match("agent_cycle", e)) {
        direction = 1
      } else if (keybind.match("agent_cycle_reverse", e)) {
        direction = -1
      }

      if (direction !== 0) {
        const current = state.workflowMode()
        let idx = WORKFLOW_MODES.indexOf(current)
        if (idx === -1) {
          idx = WORKFLOW_MODES.indexOf(local.agent.current()?.name as any)
        }
        const next = WORKFLOW_MODES[(idx + direction + WORKFLOW_MODES.length) % WORKFLOW_MODES.length]
        batch(() => {
          state.setWorkflowMode(next)
          local.agent.set(next)
        })
        e.preventDefault()
        return
      }
    }
    if (store.mode === "normal") autocomplete.onKeyDown(e)
    if (!autocomplete.visible) {
      if (
        (keybind.match("history_previous", e) && input.cursorOffset === 0) ||
        (keybind.match("history_next", e) && input.cursorOffset === input.plainText.length)
      ) {
        const direction = keybind.match("history_previous", e) ? -1 : 1
        const item = history.move(direction, input.plainText)

        if (item) {
          input.setText(item.input)
          setStore("prompt", item)
          setStore("mode", item.mode ?? "normal")
          restoreExtmarksFromParts(item.parts)
          e.preventDefault()
          if (direction === -1) input.cursorOffset = 0
          if (direction === 1) input.cursorOffset = input.plainText.length
        }
        return
      }

      if (keybind.match("history_previous", e) && input.visualCursor.visualRow === 0) input.cursorOffset = 0
      if (keybind.match("history_next", e) && input.visualCursor.visualRow === input.height - 1)
        input.cursorOffset = input.plainText.length
    }
  }

  async function onPaste(event: PasteEvent) {
    const input = refs.input()
    if (!input || input.isDestroyed) return

    if (props.disabled) {
      event.preventDefault()
      return
    }

    const normalizedText = event.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    const pastedContent = normalizedText.trim()
    if (!pastedContent) {
      command.trigger("prompt.paste")
      return
    }

    const filepath = pastedContent.replace(/^'+|'+$/g, "").replace(/\\ /g, " ")
    const isUrl = /^(https?):\/\//.test(filepath)
    if (!isUrl) {
      try {
        const file = Bun.file(filepath)
        if (file.type === "image/svg+xml") {
          event.preventDefault()
          const content = await file.text().catch(() => {})
          if (content) {
            pasteText(content, `[SVG: ${file.name ?? "image"}]`)
            return
          }
        }
        if (file.type.startsWith("image/")) {
          event.preventDefault()
          const content = await file
            .arrayBuffer()
            .then((buffer) => Buffer.from(buffer).toString("base64"))
            .catch(() => {})
          if (content) {
            await pasteImage({
              filename: file.name,
              mime: file.type,
              content,
            })
            return
          }
        }
      } catch {}
    }

    const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
    if ((lineCount >= 3 || pastedContent.length > 150) && !sync.data.config.experimental?.disable_paste_summary) {
      event.preventDefault()
      pasteText(pastedContent, `[Pasted ~${lineCount} lines]`)
      return
    }

    setTimeout(() => {
      if (!input || input.isDestroyed) return
      input.getLayoutNode().markDirty()
      renderer.requestRender()
    }, 0)
  }

  return {
    restoreExtmarksFromParts,
    syncExtmarksWithPromptParts,
    setExplainMode,
    clearPrompt,
    applyELI12Command,
    promptModelWarning,
    handleRefine,
    pasteText,
    pasteImage,
    submit,
    onKeyDown,
    onPaste,
  }
}

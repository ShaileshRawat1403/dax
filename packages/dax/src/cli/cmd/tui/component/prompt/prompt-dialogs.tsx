import { useCommandDialog } from "../dialog-command"
import { usePromptStash } from "./stash"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import { Editor } from "@tui/util/editor"
import { Clipboard } from "@tui/util/clipboard"
import { DialogSkill } from "../dialog-skill"
import { DialogStash } from "../dialog-stash"
import { useRenderer } from "@opentui/solid"
import type { TextareaRenderable } from "@opentui/core"
import type { PromptProps } from "./index"
import type { AutocompleteRef } from "./autocomplete"

export function usePromptDialogs(
  props: PromptProps,
  state: ReturnType<typeof import("./prompt-state").usePromptState>,
  handlers: ReturnType<typeof import("./prompt-handlers").usePromptHandlers>,
  refs: {
    input: () => TextareaRenderable | undefined
    autocomplete: () => AutocompleteRef | undefined
  },
) {
  const command = useCommandDialog()
  const stash = usePromptStash()
  const sdk = useSDK()
  const dialog = useDialog()
  const renderer = useRenderer()
  const { store, setStore } = state

  command.register(() => {
    const input = refs.input()
    if (!input) return []
    return [
      {
        title: "Clear prompt",
        value: "prompt.clear",
        category: "Prompt",
        hidden: true,
        onSelect: (dialog) => {
          handlers.clearPrompt()
          dialog.clear()
        },
      },
      {
        title: "Submit prompt",
        value: "prompt.submit",
        keybind: "input_submit",
        category: "Prompt",
        hidden: true,
        onSelect: (dialog) => {
          if (!input.focused) return
          handlers.submit()
          dialog.clear()
        },
      },
      {
        title: "Paste",
        value: "prompt.paste",
        keybind: "input_paste",
        category: "Prompt",
        hidden: true,
        onSelect: async () => {
          const content = await Clipboard.read()
          if (content?.mime.startsWith("image/")) {
            await handlers.pasteImage({
              filename: "clipboard",
              mime: content.mime,
              content: content.data,
            })
          }
        },
      },
      {
        title: "Interrupt session",
        value: "session.interrupt",
        keybind: "session_interrupt",
        category: "Session",
        hidden: true,
        enabled: state.status().type !== "idle",
        onSelect: (dialog) => {
          if (refs.autocomplete()?.visible) return
          if (store.mode === "shell") {
            setStore("mode", "normal")
            return
          }
          if (!props.sessionID) return

          setStore("interrupt", store.interrupt + 1)

          setTimeout(() => {
            setStore("interrupt", 0)
          }, 5000)

          if (store.interrupt >= 2) {
            sdk.client.session.abort({
              sessionID: props.sessionID,
            })
            setStore("interrupt", 0)
          }
          dialog.clear()
        },
      },
      {
        title: "Open editor",
        category: "Session",
        keybind: "editor_open",
        value: "prompt.editor",
        slash: {
          name: "editor",
        },
        onSelect: async (dialog) => {
          dialog.clear()

          const text = store.prompt.parts
            .filter((p) => p.type === "text")
            .reduce((acc, p) => {
              if (!p.source) return acc
              return acc.replace(p.source.text.value, p.text)
            }, store.prompt.input)

          const nonTextParts = store.prompt.parts.filter((p) => p.type !== "text")

          const value = text
          const content = await Editor.open({ value, renderer })
          if (!content) return

          input.setText(content)

          const updatedNonTextParts = nonTextParts
            .map((part) => {
              let virtualText = ""
              if (part.type === "file" && part.source?.text) {
                virtualText = part.source.text.value
              } else if (part.type === "agent" && part.source) {
                virtualText = part.source.value
              }

              if (!virtualText) return part

              const newStart = content.indexOf(virtualText)
              if (newStart === -1) return null

              const newEnd = newStart + virtualText.length

              if (part.type === "file" && part.source?.text) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    text: {
                      ...part.source.text,
                      start: newStart,
                      end: newEnd,
                    },
                  },
                }
              }

              if (part.type === "agent" && part.source) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    start: newStart,
                    end: newEnd,
                  },
                }
              }

              return part
            })
            .filter((part) => part !== null)

          setStore("prompt", {
            input: content,
            parts: updatedNonTextParts as any,
          })
          handlers.restoreExtmarksFromParts(updatedNonTextParts as any)
          input.cursorOffset = Bun.stringWidth(content)
        },
      },
      {
        title: "Skills",
        value: "prompt.skills",
        category: "Prompt",
        slash: {
          name: "skills",
        },
        onSelect: () => {
          dialog.replace(() => (
            <DialogSkill
              onSelect={(skill) => {
                input.setText(`/${skill} `)
                setStore("prompt", {
                  input: `/${skill} `,
                  parts: [],
                })
                input.gotoBufferEnd()
              }}
            />
          ))
        },
      },
      {
        title: "ELI12 explain last response",
        value: "prompt.eli12.explain",
        category: "Prompt",
        slash: {
          name: "eli12",
        },
        onSelect: (dialog) => {
          if (!state.explainMode()) state.setExplainMode(true)
          input.setText("/eli12")
          setStore("prompt", {
            input: "/eli12",
            parts: [],
          })
          handlers.submit()
          dialog.clear()
        },
      },
      {
        title: state.explainMode() ? "Disable ELI12 mode" : "Enable ELI12 mode",
        value: "prompt.eli12.toggle",
        category: "Prompt",
        onSelect: (dialog) => {
          state.setExplainMode(!state.explainMode())
          dialog.clear()
        },
      },
      {
        title: "Stash prompt",
        value: "prompt.stash",
        category: "Prompt",
        enabled: !!store.prompt.input,
        onSelect: (dialog) => {
          if (!store.prompt.input) return
          stash.push({
            input: store.prompt.input,
            parts: store.prompt.parts,
          })
          input.extmarks.clear()
          input.clear()
          setStore("prompt", { input: "", parts: [] })
          setStore("extmarkToPartIndex", new Map())
          dialog.clear()
        },
      },
      {
        title: "Stash pop",
        value: "prompt.stash.pop",
        category: "Prompt",
        enabled: stash.list().length > 0,
        onSelect: (dialog) => {
          const entry = stash.pop()
          if (entry) {
            input.setText(entry.input)
            setStore("prompt", { input: entry.input, parts: entry.parts })
            handlers.restoreExtmarksFromParts(entry.parts)
            input.gotoBufferEnd()
          }
          dialog.clear()
        },
      },
      {
        title: "Stash list",
        value: "prompt.stash.list",
        category: "Prompt",
        enabled: stash.list().length > 0,
        onSelect: (dialog) => {
          dialog.replace(() => (
            <DialogStash
              onSelect={(entry) => {
                input.setText(entry.input)
                setStore("prompt", { input: entry.input, parts: entry.parts })
                handlers.restoreExtmarksFromParts(entry.parts)
                input.gotoBufferEnd()
              }}
            />
          ))
        },
      },
    ]
  })
}

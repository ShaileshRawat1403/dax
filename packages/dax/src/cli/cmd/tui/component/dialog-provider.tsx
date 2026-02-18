import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { map, pipe, sortBy } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "../context/sdk"
import { DialogPrompt } from "../ui/dialog-prompt"
import { Link } from "../ui/link"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import type { ProviderAuthAuthorization } from "@dax-ai/sdk/v2"
import { DialogModel } from "./dialog-model"
import { useKeyboard } from "@opentui/solid"
import { Clipboard } from "@tui/util/clipboard"
import { useToast } from "../ui/toast"

const CORE_PROVIDER_PRIORITY: Record<string, number> = {
  openai: 0,
  google: 1,
  anthropic: 2,
  ollama: 3,
}

export function createDialogProviderOptions() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const connected = createMemo(() => new Set(sync.data.provider_next.connected))
  const showAll = createMemo(() => {
    const experimental = sync.data.config.experimental as Record<string, unknown> | undefined
    return experimental?.show_all_providers === true
  })
  const options = createMemo(() => {
    return pipe(
      sync.data.provider_next.all,
      (all) =>
        showAll()
          ? all
          : all.filter((provider) => provider.id in CORE_PROVIDER_PRIORITY || connected().has(provider.id)),
      sortBy((x) => CORE_PROVIDER_PRIORITY[x.id] ?? 99),
      map((provider) => {
        const isConnected = connected().has(provider.id)
        return {
          title: provider.name,
          value: provider.id,
          description: {
            openai: "(ChatGPT Plus/Pro or API key)",
            google: "(Gemini CLI login or API key)",
            anthropic: "(Claude subscription or API key)",
            ollama: "(Local models on your machine)",
          }[provider.id],
          category: provider.id in CORE_PROVIDER_PRIORITY ? "Core" : "Advanced",
          footer: isConnected ? "Connected" : undefined,
          async onSelect() {
            const methods = sync.data.provider_auth[provider.id] ?? [
              {
                type: "api",
                label: "API key",
              },
            ]
            let index: number | null = 0
            if (methods.length > 1) {
              index = await new Promise<number | null>((resolve) => {
                dialog.replace(
                  () => (
                    <DialogSelect
                      title="Select auth method"
                      options={methods.map((x, index) => ({
                        title: x.label,
                        value: index,
                      }))}
                      onSelect={(option) => resolve(option.value)}
                    />
                  ),
                  () => resolve(null),
                )
              })
            }
            if (index == null) return
            const method = methods[index]
            if (method.type === "oauth") {
              const result = await sdk.client.provider.oauth
                .authorize({
                  providerID: provider.id,
                  method: index,
                })
                .catch((error) => {
                  toast.error(error)
                  return undefined
                })
              if (!result?.data) return
              if (result.data.method === "code") {
                dialog.replace(() => (
                  <CodeMethod
                    providerID={provider.id}
                    title={method.label}
                    index={index}
                    authorization={result.data}
                  />
                ))
              }
              if (result.data.method === "auto") {
                dialog.replace(() => (
                  <AutoMethod
                    providerID={provider.id}
                    title={method.label}
                    index={index}
                    authorization={result.data}
                  />
                ))
              }
            }
            if (method.type === "api") {
              return dialog.replace(() => <ApiMethod providerID={provider.id} title={method.label} />)
            }
          },
        }
      }),
    )
  })
  return options
}

export function DialogProvider() {
  const options = createDialogProviderOptions()
  return <DialogSelect title="Connect a model provider" options={options()} />
}

interface AutoMethodProps {
  index: number
  providerID: string
  title: string
  authorization: ProviderAuthAuthorization
}
function AutoMethod(props: AutoMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const [hover, setHover] = createSignal(false)
  const [error, setError] = createSignal("")
  const [fatal, setFatal] = createSignal(false)
  let running = false
  let timer: ReturnType<typeof setInterval> | undefined

  function errorName(error: unknown) {
    if (!error || typeof error !== "object") return
    if ("name" in error && typeof error.name === "string") return error.name
    if ("data" in error && error.data && typeof error.data === "object" && "name" in error.data) {
      const name = error.data.name
      if (typeof name === "string") return name
    }
    if ("errors" in error && Array.isArray(error.errors) && error.errors.length > 0) {
      const first = error.errors[0]
      if (first && typeof first === "object" && "name" in first && typeof first.name === "string") return first.name
    }
  }

  function errorMessage(error: unknown) {
    if (!error || typeof error !== "object") return
    if ("message" in error && typeof error.message === "string") return error.message
    if ("data" in error && error.data && typeof error.data === "object" && "message" in error.data) {
      const message = error.data.message
      if (typeof message === "string") return message
    }
    if ("errors" in error && Array.isArray(error.errors) && error.errors.length > 0) {
      const first = error.errors[0]
      if (first && typeof first === "object" && "data" in first && first.data && typeof first.data === "object") {
        const data = first.data as Record<string, unknown>
        if (typeof data.message === "string") return data.message
      }
    }
  }

  async function attempt() {
    if (running) return
    running = true
    const result = await sdk.client.provider.oauth.callback({
      providerID: props.providerID,
      method: props.index,
    })
    if (result.error) {
      const name = errorName(result.error)
      if (name === "ProviderAuthOauthMissing") {
        setError("Authorization not ready. Complete sign-in in browser, then press r to retry.")
        running = false
        return
      }
      if (name === "ProviderAuthOauthCallbackFailed") {
        setError(
          errorMessage(result.error) ??
            "Browser callback was received, but token verification failed. Press esc and start sign-in again.",
        )
        setFatal(true)
        if (timer) clearInterval(timer)
        running = false
        return
      }
      setError(`Authorization error: ${name ?? "unknown"}. Press esc and retry.`)
      running = false
      return
    }
    if (timer) clearInterval(timer)
    await sdk.client.instance.dispose()
    await sync.bootstrap()
    dialog.replace(() => <DialogModel providerID={props.providerID} />)
    running = false
  }

  useKeyboard((evt) => {
    if (evt.name === "c" && !evt.ctrl && !evt.meta) {
      const code = props.authorization.instructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4,5}/)?.[0] ?? props.authorization.url
      Clipboard.copy(code)
        .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
        .catch(toast.error)
    }
    if (evt.name === "r" && !evt.ctrl && !evt.meta) {
      attempt().catch(toast.error)
    }
  })

  onMount(async () => {
    await attempt()
    timer = setInterval(() => {
      attempt().catch(() => {})
    }, 1500)
  })

  onCleanup(() => {
    if (!timer) return
    clearInterval(timer)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <box
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={hover() ? theme.primary : undefined}
          onMouseOver={() => setHover(true)}
          onMouseOut={() => setHover(false)}
          onMouseUp={() => dialog.clear()}
        >
          <text fg={hover() ? theme.selectedListItemText : theme.textMuted}>esc</text>
        </box>
      </box>
      <box gap={1}>
        <Link href={props.authorization.url} fg={theme.primary} />
        <text fg={theme.textMuted}>{props.authorization.instructions}</text>
      </box>
      <Show when={error()}>
        <text fg={theme.error}>{error()}</text>
      </Show>
      <text fg={theme.textMuted}>Waiting for authorization...</text>
      <text fg={theme.text}>
        c <span style={{ fg: theme.textMuted }}>copy</span>
      </text>
      <text fg={theme.text}>
        <Show when={!fatal()} fallback={<span style={{ fg: theme.textMuted }}>restart sign-in</span>}>
          r <span style={{ fg: theme.textMuted }}>retry</span>
        </Show>
      </text>
    </box>
  )
}

interface CodeMethodProps {
  index: number
  title: string
  providerID: string
  authorization: ProviderAuthAuthorization
}
function CodeMethod(props: CodeMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const [error, setError] = createSignal(false)

  return (
    <DialogPrompt
      title={props.title}
      placeholder="Authorization code"
      onConfirm={async (value) => {
        const { error } = await sdk.client.provider.oauth.callback({
          providerID: props.providerID,
          method: props.index,
          code: value,
        })
        if (!error) {
          await sdk.client.instance.dispose()
          await sync.bootstrap()
          dialog.replace(() => <DialogModel providerID={props.providerID} />)
          return
        }
        setError(true)
      }}
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>{props.authorization.instructions}</text>
          <Link href={props.authorization.url} fg={theme.primary} />
          <Show when={error()}>
            <text fg={theme.error}>Invalid code</text>
          </Show>
        </box>
      )}
    />
  )
}

interface ApiMethodProps {
  providerID: string
  title: string
}
function ApiMethod(props: ApiMethodProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title={props.title}
      placeholder="API key"
      description={
        props.providerID === "dax" ? (
          <box gap={1}>
            <text fg={theme.textMuted}>
              Dax Zen gives you access to all the best coding models at the cheapest prices with a single API key.
            </text>
            <text fg={theme.text}>
              Go to <span style={{ fg: theme.primary }}>https://dax.ai/zen</span> to get a key
            </text>
          </box>
        ) : undefined
      }
      onConfirm={async (value) => {
        if (!value) return
        await sdk.client.auth.set({
          providerID: props.providerID,
          auth: {
            type: "api",
            key: value,
          },
        })
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        dialog.replace(() => <DialogModel providerID={props.providerID} />)
      }}
    />
  )
}

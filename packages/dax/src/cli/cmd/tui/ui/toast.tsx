import { createContext, createEffect, createSignal, onCleanup, useContext, type ParentProps, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme, tint } from "@tui/context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import z from "zod"
import { TuiEvent } from "../event"

export type ToastOptions = z.infer<typeof TuiEvent.ToastShow.properties>
export type ToastPosition = "top-left" | "top-center" | "top-right"
export type ToastStyle = "pill" | "band" | "card"

// Toast renders with a 3-frame flash on appear: bright → settled background.
// This gives a "pop-in" feel without requiring layout animation.
export function Toast() {
  const toast = useToast()
  const themeState = useTheme()
  const theme = new Proxy({} as any, {
    get: (_target, prop: string) => (themeState.theme as any)[prop],
  })
  const dimensions = useTerminalDimensions()
  const [flash, setFlash] = createSignal(false)

  createEffect(() => {
    const current = toast.currentToast
    if (!current) return
    setFlash(true)
    const t1 = setTimeout(() => setFlash(false), 160)
    onCleanup(() => clearTimeout(t1))
  })

  const TOAST_MAX_LINES = 5

  return (
    <Show when={toast.currentToast}>
      {(current) => {
        const toastWidth = Math.min(72, Math.max(28, current().message.length + (current().title ? 12 : 8)))
        const effectiveWidth = Math.min(toastWidth, dimensions().width - 4)
        const fullText = current().title ? `${current().title}: ${current().message}` : current().message
        // Estimate lines needed and truncate if it would overflow max height
        const charsPerLine = effectiveWidth - 4
        const estimatedLines = Math.ceil(fullText.length / Math.max(1, charsPerLine))
        const isTruncated = estimatedLines > TOAST_MAX_LINES
        const displayText = isTruncated
          ? fullText.slice(0, charsPerLine * TOAST_MAX_LINES - 3) + "..."
          : fullText
        const bg = () =>
          flash()
            ? tint(theme[current().variant], theme.text, 0.35)
            : theme[current().variant]
        return (
          <box
            position="absolute"
            justifyContent="center"
            alignItems="flex-start"
            top={1}
            left={Math.max(1, Math.floor((dimensions().width - toastWidth) / 2))}
            width={toastWidth}
            maxWidth={effectiveWidth}
            maxHeight={TOAST_MAX_LINES + 1}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={0}
            paddingBottom={0}
            backgroundColor={bg()}
          >
            <text fg={theme.background} attributes={TextAttributes.BOLD} wrapMode="word" width="100%">
              {displayText}
            </text>
          </box>
        )
      }}
    </Show>
  )
}

function init() {
  const [store, setStore] = createStore({
    currentToast: null as ToastOptions | null,
  })

  let timeoutHandle: NodeJS.Timeout | null = null

  const toast = {
    show(options: ToastOptions) {
      const parsedOptions = TuiEvent.ToastShow.properties.parse(options)
      const { duration, ...currentToast } = parsedOptions
      setStore("currentToast", currentToast)
      if (timeoutHandle) clearTimeout(timeoutHandle)
      timeoutHandle = setTimeout(() => {
        setStore("currentToast", null)
      }, duration).unref()
    },
    error: (err: any) => {
      if (err instanceof Error)
        return toast.show({
          variant: "error",
          message: err.message,
        })
      toast.show({
        variant: "error",
        message: "An unknown error has occurred",
      })
    },
    get currentToast(): ToastOptions | null {
      return store.currentToast
    },
  }
  return toast
}

export type ToastContext = ReturnType<typeof init>

const ctx = createContext<ToastContext>()

export function ToastProvider(props: ParentProps) {
  const value = init()
  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useToast() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return value
}

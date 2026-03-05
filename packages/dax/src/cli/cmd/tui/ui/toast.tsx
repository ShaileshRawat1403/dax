import { createContext, useContext, type ParentProps, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import { SplitBorder } from "../component/border"
import { TextAttributes } from "@opentui/core"
import z from "zod"
import { TuiEvent } from "../event"
import { useKV } from "../context/kv"
import { DAX_SETTING } from "@/dax/settings"

export type ToastOptions = z.infer<typeof TuiEvent.ToastShow.properties>
export type ToastPosition = "top-left" | "top-center" | "top-right"
export type ToastStyle = "pill" | "band" | "card"

export function Toast() {
  const toast = useToast()
  const kv = useKV()
  const themeState = useTheme()
  const theme = new Proxy({} as any, {
    get: (_target, prop: string) => (themeState.theme as any)[prop],
  })
  const dimensions = useTerminalDimensions()
  const position = () => kv.get(DAX_SETTING.toast_position, "top-center") as ToastPosition
  const style = () => kv.get(DAX_SETTING.toast_style, "pill") as ToastStyle

  return (
    <Show when={toast.currentToast}>
      {(current) => (
        (function () {
          const maxWidth = Math.max(28, Math.min(72, dimensions().width - 8))
          const desiredWidth = Math.min(maxWidth, Math.max(28, current().message.length + (current().title ? 12 : 8)))
          const centerLeft = Math.max(1, Math.floor((dimensions().width - desiredWidth) / 2))

          const placement =
            position() === "top-left"
              ? { top: 1, left: 2 }
              : position() === "top-right"
                ? { top: 1, right: 2 }
                : { top: 1, left: centerLeft }

          const baseProps = {
            position: "absolute" as const,
            justifyContent: "center" as const,
            alignItems: "flex-start" as const,
            maxWidth,
            width: desiredWidth,
            ...placement,
          }

          if (style() === "pill") {
            return (
              <box
                {...baseProps}
                paddingLeft={2}
                paddingRight={2}
                paddingTop={0}
                paddingBottom={0}
                backgroundColor={theme[current().variant]}
              >
                <text fg={theme.background} attributes={TextAttributes.BOLD} wrapMode="word" width="100%">
                  <Show when={current().title}>
                    {(title) => <span>{title()}: </span>}
                  </Show>
                  {current().message}
                </text>
              </box>
            )
          }

          if (style() === "band") {
            return (
              <box
                {...baseProps}
                paddingLeft={2}
                paddingRight={2}
                paddingTop={1}
                paddingBottom={1}
                backgroundColor={theme.backgroundPanel}
                borderColor={theme[current().variant]}
                border={["bottom"]}
              >
                <text fg={theme.text} wrapMode="word" width="100%">
                  <Show when={current().title}>
                    {(title) => <span style={{ fg: theme[current().variant] }}>{title()}: </span>}
                  </Show>
                  {current().message}
                </text>
              </box>
            )
          }

          return (
            <box
              {...baseProps}
              paddingLeft={2}
              paddingRight={2}
              paddingTop={1}
              paddingBottom={1}
              backgroundColor={theme.backgroundPanel}
              borderColor={theme[current().variant]}
              border={["left", "right"]}
              customBorderChars={SplitBorder.customBorderChars}
            >
              <Show when={current().title}>
                <text attributes={TextAttributes.BOLD} marginBottom={1} fg={theme.text}>
                  {current().title}
                </text>
              </Show>
              <text fg={theme.text} wrapMode="word" width="100%">
                {current().message}
              </text>
            </box>
          )
        })()
      )}
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

import z from "zod"
import { EOL } from "os"
import { NamedError } from "@dax-ai/util/error"
import { logo as glyphs, BRAND_RAMP } from "./logo"

export namespace UI {
  export const CancelledError = NamedError.create("UICancelledError", z.void())

  export const Style = {
    TEXT_HIGHLIGHT: "\x1b[96m",
    TEXT_HIGHLIGHT_BOLD: "\x1b[96m\x1b[1m",
    TEXT_DIM: "\x1b[90m",
    TEXT_DIM_BOLD: "\x1b[90m\x1b[1m",
    TEXT_NORMAL: "\x1b[0m",
    TEXT_NORMAL_BOLD: "\x1b[1m",
    TEXT_WARNING: "\x1b[93m",
    TEXT_WARNING_BOLD: "\x1b[93m\x1b[1m",
    TEXT_DANGER: "\x1b[91m",
    TEXT_DANGER_BOLD: "\x1b[91m\x1b[1m",
    TEXT_SUCCESS: "\x1b[92m",
    TEXT_SUCCESS_BOLD: "\x1b[92m\x1b[1m",
    TEXT_INFO: "\x1b[94m",
    TEXT_INFO_BOLD: "\x1b[94m\x1b[1m",
  }

  export function println(...message: string[]) {
    print(...message)
    Bun.stderr.write(EOL)
  }

  export function print(...message: string[]) {
    blank = false
    Bun.stderr.write(message.join(" "))
  }

  let blank = false
  export function empty() {
    if (blank) return
    println("" + Style.TEXT_NORMAL)
    blank = true
  }

  /**
   * The wordmark, drawn in the brand ramp.
   *
   * It rendered in flat `gray` - the least legible neutral available - as the
   * first thing anyone sees, while dax-logo.svg carries a violet-to-blue
   * identity the terminal never used. Each column is interpolated across that
   * ramp, so the mark reads as the same object in both places. Terminals
   * without truecolor fall back to a single brand-adjacent colour rather than
   * to grey.
   */
  export function logo(pad?: string) {
    const reset = "\x1b[0m"
    const truecolor = (process.env["COLORTERM"] ?? "").includes("truecolor") || (process.env["COLORTERM"] ?? "") === "24bit"
    const width = Math.max(...glyphs.map((row) => row.length))

    const colorAt = (column: number) => {
      if (!truecolor) return "\x1b[38;5;99m"
      const t = width <= 1 ? 0 : column / (width - 1)
      const [r, g, b] = [0, 1, 2].map((i) =>
        Math.round(BRAND_RAMP.from[i]! + (BRAND_RAMP.to[i]! - BRAND_RAMP.from[i]!) * t),
      )
      return `\x1b[38;2;${r};${g};${b}m`
    }

    return glyphs
      .map((row) => {
        const cells = [...row].map((char, column) => (char === " " ? " " : colorAt(column) + char))
        return (pad ?? "") + cells.join("") + reset
      })
      .join(EOL)
  }

  export async function input(prompt: string): Promise<string> {
    const readline = require("readline")
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    return new Promise((resolve) => {
      rl.question(prompt, (answer: string) => {
        rl.close()
        resolve(answer.trim())
      })
    })
  }

  export function error(message: string) {
    println(Style.TEXT_DANGER_BOLD + "Error: " + Style.TEXT_NORMAL + message)
  }

  export function markdown(text: string): string {
    return text
  }
}

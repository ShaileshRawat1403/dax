import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

/**
 * Contrast and hue separation for the first-party themes.
 *
 * These are the two properties that decide whether the interface can be read
 * and whether its colours can carry meaning. Both were failing silently: the
 * `dax` theme put body text at 3.67:1, and four semantic roles in the default
 * sat within 1.28 of each other, so hue could not distinguish a heading from a
 * link from a type.
 */
function parse(hex: string): [number, number, number] {
  const h = hex.replace("#", "")
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}
function luminance(rgb: number[]): number {
  const n = rgb.map((v) => v / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
  return 0.2126 * n[0]! + 0.7152 * n[1]! + 0.0722 * n[2]!
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(parse(a)), luminance(parse(b))].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}
function hue(hex: string): number {
  const [r, g, b] = parse(hex).map((v) => v / 255) as [number, number, number]
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  if (!d) return 0
  const h = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4)
  return (h + 360) % 360
}
function saturation(hex: string): number {
  const [r, g, b] = parse(hex).map((v) => v / 255) as [number, number, number]
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2
  return d ? d / (1 - Math.abs(2 * l - 1)) : 0
}
function load(name: string) {
  const file = path.join(import.meta.dir, `${name}.json`)
  const raw = JSON.parse(readFileSync(file, "utf8"))
  const resolve = (key: string) => (raw.defs?.[raw.theme[key]] ?? raw.theme[key]) as string
  return { resolve, background: resolve("background") }
}

const FIRST_PARTY = ["dax-pro", "dax"]
const TEXT_ROLES = ["text", "textMuted", "primary", "secondary", "accent", "error", "warning", "success", "info"]

describe("first-party palettes", () => {
  for (const name of FIRST_PARTY) {
    test(`${name}: every text role clears 4.5:1`, () => {
      const { resolve, background } = load(name)
      const failures = TEXT_ROLES.map((role) => [role, contrast(resolve(role), background)] as const)
        .filter(([, ratio]) => ratio < 4.5)
        .map(([role, ratio]) => `${role} ${ratio.toFixed(2)}`)
      expect(failures).toEqual([])
    })
  }

  test("dax-pro: roles that encode different meanings differ in hue or saturation", () => {
    const { resolve } = load("dax-pro")
    const roles = ["primary", "secondary", "accent", "info", "success", "warning", "error", "highlight"]
    const tooClose: string[] = []
    for (let i = 0; i < roles.length; i++) {
      for (let j = i + 1; j < roles.length; j++) {
        const a = resolve(roles[i]!), b = resolve(roles[j]!)
        let gap = Math.abs(hue(a) - hue(b))
        if (gap > 180) gap = 360 - gap
        if (gap >= 30) continue
        // A shared hue is acceptable when saturation separates them clearly:
        // a 63% amber is a signal, a 20% warm neutral is a tint.
        const ratio = Math.max(saturation(a), saturation(b)) / Math.max(0.01, Math.min(saturation(a), saturation(b)))
        if (ratio < 2) tooClose.push(`${roles[i]}/${roles[j]} ${Math.round(gap)}deg`)
      }
    }
    expect(tooClose).toEqual([])
  })
})

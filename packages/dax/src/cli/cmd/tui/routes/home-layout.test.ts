import { describe, expect, it } from "bun:test"
import { deriveHomeLayout } from "./home-layout"

describe("home layout model", () => {
  it("keeps the prompt available on compact but usable terminals", () => {
    const layout = deriveHomeLayout({
      width: 64,
      height: 18,
      sessionCount: 3,
      tipsVisible: true,
    })

    expect(layout.showInput).toBe(true)
    expect(layout.showMascot).toBe(false)
    expect(layout.showFirstRunGuide).toBe(false)
    expect(layout.showSessions).toBe(false)
    expect(layout.outerJustify).toBe("flex-start")
  })

  it("hides lower-priority sections before the brand and prompt on short layouts", () => {
    const layout = deriveHomeLayout({
      width: 72,
      height: 23,
      sessionCount: 3,
      tipsVisible: true,
    })

    expect(layout.showInput).toBe(true)
    expect(layout.showFirstRunGuide).toBe(false)
    expect(layout.showSessions).toBe(false)
    expect(layout.showTips).toBe(false)
  })

  it("allows richer home content only on larger terminals", () => {
    const layout = deriveHomeLayout({
      width: 96,
      height: 36,
      sessionCount: 3,
      tipsVisible: true,
    })

    expect(layout.showMascot).toBe(true)
    expect(layout.showActions).toBe(true)
    expect(layout.showFirstRunGuide).toBe(false)
    expect(layout.showSessions).toBe(true)
    expect(layout.showTips).toBe(true)
    expect(layout.outerJustify).toBe("center")
    expect(layout.maxWidth).toBe(76)
  })
})

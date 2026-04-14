export type HomeLayout = {
  size: "tiny" | "small" | "medium"
  showInput: boolean
  showMascot: boolean
  showActions: boolean
  showFirstRunGuide: boolean
  showSessions: boolean
  showTips: boolean
  outerJustify: "flex-start" | "center"
  maxWidth?: number
}

export function deriveHomeLayout(input: {
  width: number
  height: number
  sessionCount: number
  tipsVisible: boolean
}): HomeLayout {
  const { width, height, sessionCount, tipsVisible } = input

  const size: HomeLayout["size"] = width < 50 || height < 16 ? "tiny" : width < 70 || height < 22 ? "small" : "medium"

  return {
    size,
    showInput: height >= 14,
    // Mascot sits beside the greeting — only needs enough width for both
    showMascot: width >= 56 && height >= 20 && size !== "tiny",
    showActions: width >= 52 && height >= 18,
    showFirstRunGuide: width >= 60 && height >= 26 && sessionCount === 0,
    showSessions: width >= 60 && height >= 24 && sessionCount > 0,
    showTips: width >= 64 && height >= 30 && tipsVisible && sessionCount > 0,
    outerJustify: height >= 34 ? "center" : "flex-start",
    // Wider max so workspace card and chips have room
    maxWidth: width < 70 ? undefined : 88,
  }
}

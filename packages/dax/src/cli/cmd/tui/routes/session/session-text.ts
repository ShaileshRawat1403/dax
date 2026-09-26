/** Session identity separates delegation before TextPart is rendered. */
export function shouldRenderSessionText(part: { text: string }): boolean {
  return part.text.trim().length > 0
}

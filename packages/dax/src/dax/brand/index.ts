export const DAX_BRAND = {
  name: "DAX",
  expanded: "Deterministic Agentic Execution",
  category: "AI-assisted execution",
  sdlc: "Natural language programming for software delivery",
} as const

export function productTitle() {
  return DAX_BRAND.name
}

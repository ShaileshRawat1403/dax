export function openAIGptMajor(modelId: string): number | undefined {
  const match = /^gpt-(\d+)(?:[.-]|$)/i.exec(modelId)
  if (!match) return undefined
  return Number(match[1])
}

export function isGpt5OrLater(modelId: string): boolean {
  const major = openAIGptMajor(modelId)
  return major !== undefined && major >= 5
}

export function isGpt56Family(modelId: string): boolean {
  return /^gpt-5\.6(?:-|$)/i.test(modelId)
}

export function isGpt6Astra(modelId: string): boolean {
  return modelId.toLowerCase() === "gpt-6-astra"
}

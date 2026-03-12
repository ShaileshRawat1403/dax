type TokenUsage = {
  input?: number
  output?: number
  reasoning?: number
  cache?: {
    read?: number
    write?: number
  }
}

type AssistantLike = {
  role: string
  cost?: number
  providerID?: string
  modelID?: string
  tokens?: TokenUsage
}

type ProviderLike = {
  id: string
  models: Record<string, { limit?: { context?: number } }>
}

export function tokenTotal(tokens?: TokenUsage) {
  if (!tokens) return 0
  return (
    (tokens.input ?? 0) +
    (tokens.output ?? 0) +
    (tokens.reasoning ?? 0) +
    (tokens.cache?.read ?? 0) +
    (tokens.cache?.write ?? 0)
  )
}

export function sessionAssistantMessages<T extends AssistantLike>(messages: readonly T[]) {
  return messages.filter((message) => message.role === "assistant")
}

export function sessionTokenTotal<T extends AssistantLike>(messages: readonly T[]) {
  return sessionAssistantMessages(messages).reduce((sum, message) => sum + tokenTotal(message.tokens), 0)
}

export function sessionCostTotal<T extends AssistantLike>(messages: readonly T[]) {
  return sessionAssistantMessages(messages).reduce((sum, message) => sum + (message.cost ?? 0), 0)
}

export function formatUsd(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

export function latestContextUsage<T extends AssistantLike>(
  messages: readonly T[],
  providers: readonly ProviderLike[],
) {
  const last = [...messages].reverse().find((message) => message.role === "assistant" && tokenTotal(message.tokens) > 0)
  if (!last?.providerID || !last.modelID) return
  const model = providers.find((provider) => provider.id === last.providerID)?.models[last.modelID]
  const total = tokenTotal(last.tokens)
  return {
    tokens: total,
    percentage: model?.limit?.context ? Math.round((total / model.limit.context) * 100) : null,
  }
}

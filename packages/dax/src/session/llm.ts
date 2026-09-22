import { Installation } from "@/installation"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import {
  streamText,
  wrapLanguageModel,
  type ModelMessage,
  type StreamTextResult,
  type Tool,
  type ToolSet,
  tool,
  jsonSchema,
} from "ai"
import { asSchema } from "@ai-sdk/provider-utils"
import { clone, mergeDeep, pipe } from "remeda"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { SystemPrompt } from "./system"
import { Flag } from "@/flag/flag"
import { Permission } from "@/governance"
import { Auth } from "@/auth"
import { assertProviderAuth } from "@/provider/auth-preflight"
import {
  PromptProvenancePersistenceError,
  type PromptEffectiveCandidate,
  type PromptInstructionSource,
  type PromptProvenanceTracker,
} from "@/execution/prompt-provenance"
import { ContextProvenancePersistenceError, type ContextProvenanceTracker } from "@/execution/context-provenance"
import {
  buildProviderInputPartition,
  commitProviderInputValue,
  type ProviderInputPartition,
  type ProviderInputSourceCandidate,
} from "@/execution/provider-input-partition"

const PROVIDER_INPUT_IDENTITY = Symbol("dax.provider-input-identity")

type ProviderInputIdentity = { message: number; part?: number }

function taggedProviderPrompt(prompt: ModelMessage[]): ModelMessage[] {
  return prompt.map((message, messageIndex) => {
    const tagged = {
      ...message,
      [PROVIDER_INPUT_IDENTITY]: { message: messageIndex },
    } as ModelMessage & { [PROVIDER_INPUT_IDENTITY]: ProviderInputIdentity }
    if (Array.isArray(message.content)) {
      tagged.content = message.content.map((part, partIndex) =>
        part && typeof part === "object"
          ? { ...part, [PROVIDER_INPUT_IDENTITY]: { message: messageIndex, part: partIndex } }
          : part,
      ) as typeof tagged.content
    }
    return tagged
  })
}

function readProviderInputIdentity(value: unknown): ProviderInputIdentity | null {
  if (!value || typeof value !== "object") return null
  const identity = (value as Record<PropertyKey, unknown>)[PROVIDER_INPUT_IDENTITY]
  if (!identity || typeof identity !== "object") return null
  const candidate = identity as { message?: unknown; part?: unknown }
  if (!Number.isInteger(candidate.message)) return null
  if (candidate.part !== undefined && !Number.isInteger(candidate.part)) return null
  return candidate as ProviderInputIdentity
}

function sdkProviderInputMetadata(input: {
  prompt: ModelMessage[]
  effectiveCandidates: PromptEffectiveCandidate[]
  contextSources: ProviderInputSourceCandidate[]
}): {
  effectiveCandidates: PromptEffectiveCandidate[]
  contextSources: ProviderInputSourceCandidate[]
} {
  const promptParts = input.prompt.flatMap((message, messageIndex) => {
    const content = Array.isArray(message.content) ? message.content : [message.content]
    return content.map((value, part) => ({ message: messageIndex, part, role: message.role, value }))
  })
  const sameValue = (left: unknown, right: unknown, kind: ProviderInputSourceCandidate["kind"] = "other") =>
    commitProviderInputValue(left, kind).digest === commitProviderInputValue(right, kind).digest

  const effectiveCandidates = input.effectiveCandidates.map((candidate) => {
    if (candidate.channel !== "message" || !candidate.locator) return candidate
    const identityValue = candidate.identityValue ?? candidate.value
    const matches = promptParts.filter((part) => {
      if (part.role !== candidate.role) return false
      if (typeof identityValue === "string") {
        return (
          (typeof part.value === "string" && part.value === identityValue) ||
          (part.value !== null &&
            typeof part.value === "object" &&
            (part.value as { type?: unknown }).type === "text" &&
            (part.value as { text?: unknown }).text === identityValue)
        )
      }
      return sameValue(part.value, identityValue)
    })
    const hinted = matches.filter((part) => part.message === candidate.locator!.messageIndex)
    const selected = hinted.length === 1 ? hinted[0] : hinted.length === 0 && matches.length === 1 ? matches[0] : null
    if (!selected) throw new Error("Message instruction identity was ambiguous before provider normalization")
    return {
      ...candidate,
      locator: { messageIndex: selected.message, contentPartIndex: selected.part },
    }
  })

  const contextSources = input.contextSources.flatMap((source) => {
    const matches: Array<{ message: number; part?: number }> =
      source.locator.part === undefined
        ? input.prompt.flatMap((message, messageIndex) => {
            const { content: _content, ...envelope } = message
            return sameValue(envelope, source.value, source.kind) ? [{ message: messageIndex }] : []
          })
        : promptParts.flatMap((part) =>
            sameValue(part.value, source.value, source.kind) ? [{ message: part.message, part: part.part }] : [],
          )
    const hinted = matches.filter(
      (location) =>
        location.message === source.locator.message &&
        (source.locator.part === undefined || ("part" in location && location.part === source.locator.part)),
    )
    const selected = hinted.length === 1 ? hinted[0] : hinted.length === 0 && matches.length === 1 ? matches[0] : null
    return selected ? [{ ...source, locator: selected }] : []
  })
  const occurrences = new Map<string, number>()
  for (const source of contextSources) {
    const key = `${source.locator.message}:${source.locator.part ?? "*"}`
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1)
  }
  return {
    effectiveCandidates,
    contextSources: contextSources.filter(
      (source) => occurrences.get(`${source.locator.message}:${source.locator.part ?? "*"}`) === 1,
    ),
  }
}

function rebaseProviderInputMetadata(input: {
  prompt: ModelMessage[]
  effectiveCandidates: PromptEffectiveCandidate[]
  contextSources: ProviderInputSourceCandidate[]
}): {
  effectiveCandidates: PromptEffectiveCandidate[]
  contextSources: ProviderInputSourceCandidate[]
} {
  const messages = new Map<number, number>()
  const parts = new Map<string, { message: number; part: number }>()
  const addMessage = (original: number, current: number) => {
    if (messages.has(original)) throw new Error("Provider transformation duplicated a message identity")
    messages.set(original, current)
  }
  const addPart = (identity: Required<ProviderInputIdentity>, message: number, part: number) => {
    const key = `${identity.message}:${identity.part}`
    if (parts.has(key)) throw new Error("Provider transformation duplicated a content identity")
    parts.set(key, { message, part })
  }

  for (const [messageIndex, value] of input.prompt.entries()) {
    const messageIdentity = readProviderInputIdentity(value)
    if (messageIdentity) {
      if (messageIdentity.part !== undefined) throw new Error("Provider message carried a content identity")
      addMessage(messageIdentity.message, messageIndex)
    }
    if (!Array.isArray(value.content)) continue
    for (const [partIndex, part] of value.content.entries()) {
      const partIdentity = readProviderInputIdentity(part)
      if (!partIdentity) continue
      if (partIdentity.part === undefined) throw new Error("Provider content carried a message identity")
      if (messageIdentity && messageIdentity.message !== partIdentity.message) {
        throw new Error("Provider transformation moved content across message identities")
      }
      addPart(partIdentity as Required<ProviderInputIdentity>, messageIndex, partIndex)
    }
  }

  for (const value of input.prompt) {
    delete (value as unknown as Record<PropertyKey, unknown>)[PROVIDER_INPUT_IDENTITY]
    if (!Array.isArray(value.content)) continue
    for (const part of value.content) {
      if (part && typeof part === "object") {
        delete (part as unknown as Record<PropertyKey, unknown>)[PROVIDER_INPUT_IDENTITY]
      }
    }
  }

  const locate = (locator: { messageIndex: number; contentPartIndex?: number }) => {
    if (locator.contentPartIndex === undefined) {
      const messageIndex = messages.get(locator.messageIndex)
      return messageIndex === undefined ? null : { messageIndex }
    }
    const location = parts.get(`${locator.messageIndex}:${locator.contentPartIndex}`)
    return location ? { messageIndex: location.message, contentPartIndex: location.part } : null
  }
  const effectiveCandidates = input.effectiveCandidates.map((candidate) => {
    if (!candidate.locator) return candidate
    const locator = locate(candidate.locator)
    if (!locator) throw new Error("Message instruction identity was destroyed before provider dispatch")
    return { ...candidate, locator }
  })
  const contextSources = input.contextSources.flatMap((source) => {
    const locator =
      source.locator.part === undefined
        ? (() => {
            const message = messages.get(source.locator.message)
            return message === undefined ? null : { message }
          })()
        : (() => {
            const location = parts.get(`${source.locator.message}:${source.locator.part}`)
            return location ? { message: location.message, part: location.part } : null
          })()
    return locator ? [{ ...source, locator }] : []
  })
  return { effectiveCandidates, contextSources }
}

export namespace LLM {
  const log = Log.create({ service: "llm" })

  export const OUTPUT_TOKEN_MAX = Flag.DAX_EXPERIMENTAL_OUTPUT_TOKEN_MAX || 32_000

  export type StreamInput = {
    user: MessageV2.User
    sessionID: string
    model: Provider.Model
    agent: Agent.Info
    system: string[]
    abort: AbortSignal
    messages: ModelMessage[]
    small?: boolean
    tools: Record<string, Tool>
    retries?: number
    instructionSources?: PromptInstructionSource[]
    instructionCandidates?: PromptEffectiveCandidate[]
    promptProvenance?: PromptProvenanceTracker
    contextProvenance?: ContextProvenanceTracker
    contextSources?: ProviderInputSourceCandidate[]
  }

  export type StreamOutput = StreamTextResult<ToolSet, unknown>

  export async function stream(input: StreamInput) {
    const l = log
      .clone()
      .tag("providerID", input.model.providerID)
      .tag("modelID", input.model.id)
      .tag("sessionID", input.sessionID)
      .tag("small", (input.small ?? false).toString())
      .tag("agent", input.agent.name)
      .tag("mode", input.agent.mode)
    l.info("stream", {
      modelID: input.model.id,
      providerID: input.model.providerID,
    })
    await assertProviderAuth(input.model.providerID)
    const [language, cfg, provider, auth] = await Promise.all([
      Provider.getLanguage(input.model),
      Config.get(),
      Provider.getProvider(input.model.providerID),
      Auth.get(input.model.providerID),
    ])
    const isCodex = provider.id === "openai" && auth?.type === "oauth"

    const callerInstructionSources = input.instructionSources ?? []
    const supplied: PromptInstructionSource[] = [...callerInstructionSources]
    const systemParts: Array<{ text: string; sourceId: string }> = []
    if (input.agent.prompt) {
      const sourceId = `agent_prompt:${input.agent.name}`
      supplied.push({
        sourceId,
        kind: "agent_prompt",
        reference: input.agent.name,
        channel: "system",
        role: "system",
        value: input.agent.prompt,
      })
      systemParts.push({ text: input.agent.prompt, sourceId })
    } else if (!isCodex) {
      for (const [index, text] of SystemPrompt.provider(input.model).entries()) {
        const sourceId = `provider_prompt:${input.model.api.id}:${index}`
        supplied.push({
          sourceId,
          kind: "provider_prompt",
          reference: input.model.api.id,
          channel: "system",
          role: "system",
          value: text,
        })
        systemParts.push({ text, sourceId })
      }
    }
    const callerSystemSources = callerInstructionSources.filter((source) => source.channel === "system")
    for (const [index, text] of input.system.entries()) {
      const source = callerSystemSources[index]
      if ((!source || source.value !== text) && input.promptProvenance) {
        throw new PromptProvenancePersistenceError(
          "dispatch",
          input.promptProvenance.messageId ?? input.user.id,
          new Error(`System instruction ${index} has no typed source metadata`),
        )
      }
      systemParts.push({ text, sourceId: source?.sourceId ?? `unscoped_system:${index}` })
    }
    if (input.user.system) {
      const sourceId = `user_system:${input.user.id}`
      supplied.push({
        sourceId,
        kind: "user_system",
        reference: input.user.id,
        channel: "system",
        role: "system",
        value: input.user.system,
      })
      systemParts.push({ text: input.user.system, sourceId })
    }

    const system = [
      systemParts
        .map((part) => part.text)
        .filter(Boolean)
        .join("\n"),
    ]

    const header = system[0]
    const original = clone(system)
    await Plugin.trigger(
      "experimental.chat.system.transform",
      { sessionID: input.sessionID, model: input.model },
      { system },
    )
    if (system.length === 0) {
      system.push(...original)
    }
    // rejoin to maintain 2-part structure for caching if header unchanged
    if (system.length > 2 && system[0] === header) {
      const rest = system.slice(1)
      system.length = 0
      system.push(header, rest.join("\n"))
    }

    const variant =
      !input.small && input.model.variants && input.user.variant ? input.model.variants[input.user.variant] : {}
    const base = input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options({
          model: input.model,
          sessionID: input.sessionID,
          providerOptions: provider.options,
        })
    const options: Record<string, any> = pipe(
      base,
      mergeDeep(input.model.options),
      mergeDeep(input.agent.options),
      mergeDeep(variant),
    )
    if (isCodex) {
      options.instructions = SystemPrompt.instructions()
      supplied.push({
        sourceId: `provider_instructions:${input.model.api.id}`,
        kind: "provider_instructions",
        reference: input.model.api.id,
        channel: "provider_option",
        value: options.instructions,
      })
    }

    const params = await Plugin.trigger(
      "chat.params",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        temperature: input.model.capabilities.temperature
          ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
          : undefined,
        topP: input.agent.topP ?? ProviderTransform.topP(input.model),
        topK: ProviderTransform.topK(input.model),
        options,
      },
    )

    const { headers } = await Plugin.trigger(
      "chat.headers",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        headers: {},
      },
    )

    const maxOutputTokens =
      isCodex || provider.id.includes("github-copilot")
        ? undefined
        : ProviderTransform.maxOutputTokens(
            input.model.api.npm,
            params.options,
            input.model.limit.output,
            OUTPUT_TOKEN_MAX,
          )

    let tools = await resolveTools(input)
    if (!input.model.capabilities.toolcall) {
      log.info("model does not support tools, stripping from request", {
        modelID: input.model.id,
      })
      tools = {}
    }
    for (const [name, definition] of Object.entries(tools)) {
      const value =
        definition.type === "provider-defined"
          ? {
              type: "provider-defined",
              name,
              id: definition.id,
              args: definition.args,
            }
          : {
              type: "function",
              name,
              description: definition.description,
              inputSchema: asSchema(definition.inputSchema).jsonSchema,
              providerOptions: definition.providerOptions,
            }
      supplied.push({
        sourceId: `tool_definition:${name}`,
        kind: "tool_definition",
        reference: name,
        channel: "tool",
        value,
      })
    }

    // LiteLLM and some Anthropic proxies require the tools parameter to be present
    // when message history contains tool calls, even if no tools are being used.
    // Add a dummy tool that is never called to satisfy this validation.
    // This is enabled for:
    // 1. Providers with "litellm" in their ID or API ID (auto-detected)
    // 2. Providers with explicit "litellmProxy: true" option (opt-in for custom gateways)
    const isLiteLLMProxy =
      provider.options?.["litellmProxy"] === true ||
      input.model.providerID.toLowerCase().includes("litellm") ||
      input.model.api.id.toLowerCase().includes("litellm")

    if (isLiteLLMProxy && Object.keys(tools).length === 0 && hasToolCalls(input.messages)) {
      tools["_noop"] = tool({
        description:
          "Placeholder for LiteLLM/Anthropic proxy compatibility - required when message history contains tool calls but no active tools are needed",
        inputSchema: jsonSchema({ type: "object", properties: {} }),
        execute: async () => ({ output: "", title: "", metadata: {} }),
      })
    }

    const effectiveCandidates: PromptEffectiveCandidate[] = (input.instructionCandidates ?? []).map((candidate) => ({
      ...candidate,
      ...(candidate.locator
        ? {
            locator: {
              ...candidate.locator,
              messageIndex: system.length + candidate.locator.messageIndex,
            },
          }
        : {}),
    }))
    const contextSources: ProviderInputSourceCandidate[] = (input.contextSources ?? []).map((source) => ({
      ...source,
      locator: {
        ...source.locator,
        message: system.length + source.locator.message,
      },
    }))
    if (input.promptProvenance) {
      const locatedSourceIds = new Set(effectiveCandidates.flatMap((candidate) => candidate.sourceIds))
      const missingMessageSource = supplied.find(
        (source) => source.channel === "message" && !locatedSourceIds.has(source.sourceId),
      )
      if (missingMessageSource) {
        throw new PromptProvenancePersistenceError(
          "dispatch",
          input.promptProvenance.messageId ?? input.user.id,
          new Error(`Message instruction ${missingMessageSource.sourceId} lost its assembly identity`),
        )
      }
    }
    const originalSourceIds = systemParts.filter((part) => part.text).map((part) => part.sourceId)
    for (const [messageIndex, text] of system.entries()) {
      effectiveCandidates.push({
        channel: "system",
        role: "system",
        value: text,
        sourceIds: text === original[0] ? originalSourceIds : [],
        locator: { messageIndex },
      })
    }
    if (isCodex && params.options.instructions !== undefined) {
      const originalInstructions = supplied.find((source) => source.kind === "provider_instructions")
      effectiveCandidates.push({
        channel: "provider_option",
        value: params.options.instructions,
        sourceIds:
          originalInstructions && params.options.instructions === originalInstructions.value
            ? [originalInstructions.sourceId]
            : [],
      })
    }

    return streamText({
      onError(error) {
        l.error("stream error", {
          error,
        })
      },
      async experimental_repairToolCall(failed) {
        const lower = failed.toolCall.toolName.toLowerCase()
        if (lower !== failed.toolCall.toolName && tools[lower]) {
          l.info("repairing tool call", {
            tool: failed.toolCall.toolName,
            repaired: lower,
          })
          return {
            ...failed.toolCall,
            toolName: lower,
          }
        }
        return {
          ...failed.toolCall,
          input: JSON.stringify({
            tool: failed.toolCall.toolName,
            error: failed.error.message,
          }),
          toolName: "invalid",
        }
      },
      temperature: params.temperature,
      topP: params.topP,
      topK: params.topK,
      providerOptions: ProviderTransform.providerOptions(input.model, params.options),
      activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
      tools,
      maxOutputTokens,
      abortSignal: input.abort,
      headers: {
        ...(input.model.providerID.startsWith("dax")
          ? {
              "x-dax-project": Instance.project.id,
              "x-dax-session": input.sessionID,
              "x-dax-request": input.user.id,
              "x-dax-client": Flag.DAX_CLIENT,
            }
          : input.model.providerID !== "anthropic"
            ? {
                "User-Agent": `dax/${Installation.VERSION}`,
              }
            : undefined),
        ...input.model.headers,
        ...headers,
      },
      // SDK-level retries happen below the provenance middleware and would make
      // one durable input commitment cover multiple provider calls. Governed
      // SessionProcessor dispatches therefore retry only in SessionProcessor,
      // where each adapter call receives its own ordinal and event.
      maxRetries: input.promptProvenance || input.contextProvenance ? 0 : (input.retries ?? 0),
      messages: [
        ...system.map(
          (x): ModelMessage => ({
            role: "system",
            content: x,
          }),
        ),
        ...input.messages,
      ],
      model: wrapLanguageModel({
        model: language,
        middleware: [
          {
            async transformParams(args) {
              if (args.type === "stream") {
                if (!input.promptProvenance && !input.contextProvenance) {
                  // @ts-expect-error AI SDK middleware prompt types lag the concrete provider prompt.
                  args.params.prompt = ProviderTransform.message(args.params.prompt, input.model, options)
                  return args.params
                }
                let sdkMetadata: ReturnType<typeof sdkProviderInputMetadata>
                try {
                  sdkMetadata = sdkProviderInputMetadata({
                    prompt: args.params.prompt,
                    effectiveCandidates,
                    contextSources,
                  })
                } catch (error) {
                  throw new PromptProvenancePersistenceError(
                    "dispatch",
                    input.promptProvenance?.messageId ?? input.contextProvenance?.messageId ?? input.user.id,
                    error,
                  )
                }
                // @ts-expect-error
                args.params.prompt = ProviderTransform.message(
                  taggedProviderPrompt(args.params.prompt),
                  input.model,
                  options,
                )
                let dispatchMetadata: ReturnType<typeof rebaseProviderInputMetadata>
                try {
                  dispatchMetadata = rebaseProviderInputMetadata({
                    prompt: args.params.prompt,
                    effectiveCandidates: sdkMetadata.effectiveCandidates,
                    contextSources: sdkMetadata.contextSources,
                  })
                } catch (error) {
                  throw new PromptProvenancePersistenceError(
                    "dispatch",
                    input.promptProvenance?.messageId ?? input.contextProvenance?.messageId ?? input.user.id,
                    error,
                  )
                }
                const instructionLocators = dispatchMetadata.effectiveCandidates.flatMap((candidate) => {
                  if ((candidate.channel !== "system" && candidate.channel !== "message") || !candidate.locator) {
                    return []
                  }
                  return [
                    {
                      message: candidate.locator.messageIndex,
                      ...(candidate.locator.contentPartIndex === undefined
                        ? {}
                        : { part: candidate.locator.contentPartIndex }),
                    },
                  ]
                })
                let partition: ProviderInputPartition
                try {
                  partition = buildProviderInputPartition({
                    prompt: args.params.prompt,
                    tools: args.params.tools,
                    providerOptions: args.params.providerOptions,
                    instructionLocators,
                    sources: dispatchMetadata.contextSources,
                  })
                } catch (error) {
                  throw new ContextProvenancePersistenceError(
                    "dispatch",
                    input.contextProvenance?.messageId ?? input.promptProvenance?.messageId ?? input.user.id,
                    error,
                  )
                }
                const { atoms: _atoms, ...partitionSummary } = partition
                await input.promptProvenance?.record({
                  providerId: input.model.providerID,
                  modelId: input.model.id,
                  prompt: args.params.prompt,
                  tools: args.params.tools,
                  providerOptions: args.params.providerOptions,
                  supplied,
                  effectiveCandidates: dispatchMetadata.effectiveCandidates,
                  partition: partitionSummary,
                })
                if (input.contextProvenance) {
                  const promptRecord = input.promptProvenance?.settlement()
                  if (!promptRecord?.finalEventId || promptRecord.count < 1) {
                    throw new ContextProvenancePersistenceError(
                      "dispatch",
                      input.contextProvenance.messageId ?? input.user.id,
                      new Error("Context provenance requires a durable prompt dispatch"),
                    )
                  }
                  await input.contextProvenance.record({
                    providerId: input.model.providerID,
                    modelId: input.model.id,
                    promptEventId: promptRecord.finalEventId,
                    dispatchOrdinal: promptRecord.count,
                    partition,
                  })
                }
              }
              return args.params
            },
          },
        ],
      }),
      experimental_telemetry: {
        isEnabled: cfg.experimental?.openTelemetry,
        metadata: {
          userId: cfg.username ?? "unknown",
          sessionId: input.sessionID,
        },
      },
    })
  }

  async function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "user">) {
    const disabled = Permission.disabled(Object.keys(input.tools), input.agent.permission)
    for (const tool of Object.keys(input.tools)) {
      if (input.user.tools?.[tool] === false || disabled.has(tool)) {
        delete input.tools[tool]
      }
    }
    return input.tools
  }

  // Check if messages contain any tool-call content
  // Used to determine if a dummy tool should be added for LiteLLM proxy compatibility
  export function hasToolCalls(messages: ModelMessage[]): boolean {
    for (const msg of messages) {
      if (!Array.isArray(msg.content)) continue
      for (const part of msg.content) {
        if (part.type === "tool-call" || part.type === "tool-result") return true
      }
    }
    return false
  }
}

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

    const system = [systemParts.map((part) => part.text).filter(Boolean).join("\n")]

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
      maxRetries: input.promptProvenance ? 0 : (input.retries ?? 0),
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
                // @ts-expect-error
                args.params.prompt = ProviderTransform.message(args.params.prompt, input.model, options)
                await input.promptProvenance?.record({
                  providerId: input.model.providerID,
                  modelId: input.model.id,
                  prompt: args.params.prompt,
                  tools: args.params.tools,
                  providerOptions: args.params.providerOptions,
                  supplied,
                  effectiveCandidates,
                })
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

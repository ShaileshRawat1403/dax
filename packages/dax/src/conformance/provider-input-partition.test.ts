import { describe, expect, test } from "bun:test"
import {
  buildProviderInputPartition,
  commitProviderInputValue,
  opaqueProviderInputSources,
  recomputeProviderInputPartitionDigest,
} from "@/execution/provider-input-partition"

describe("provider-input instruction/context partition", () => {
  test("accounts for every ordered atom exactly once with opaque locations", () => {
    const messages = [
      { role: "system", content: "system instruction secret" },
      {
        role: "user",
        providerOptions: { trace: "envelope secret" },
        content: [
          { type: "text", text: "user-role instruction secret" },
          { type: "text", text: "ordinary context secret" },
          { type: "file", mediaType: "image/png", data: "cGl4ZWxz" },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "prior assistant context secret" }] },
    ]
    const partition = buildProviderInputPartition({
      prompt: messages,
      tools: {
        "sensitive-tool-name": {
          type: "function",
          name: "sensitive-tool-name",
          description: "tool description secret",
        },
      },
      providerOptions: { nested: { instructions: "provider instruction secret" } },
      instructionLocators: [{ message: 1, part: 0 }],
      sources: opaqueProviderInputSources(messages),
    })

    expect(partition.atoms.map((atom) => atom.ordinal)).toEqual(partition.atoms.map((_, index) => index))
    expect([...partition.instructionAtomOrdinals, ...partition.contextAtomOrdinals].sort((a, b) => a - b)).toEqual(
      partition.atoms.map((atom) => atom.ordinal),
    )
    expect(new Set(partition.atoms.map((atom) => JSON.stringify(atom.location))).size).toBe(partition.atomCount)
    expect(recomputeProviderInputPartitionDigest(partition.atoms)).toBe(partition.digest)
    expect(partition.atoms).toContainEqual(
      expect.objectContaining({
        location: { kind: "message_content", message: 1, part: 0 },
        owner: "instruction",
      }),
    )
    expect(partition.atoms).toContainEqual(
      expect.objectContaining({
        location: { kind: "message_content", message: 1, part: 1 },
        owner: "context",
      }),
    )
    expect(partition.atoms).toContainEqual(
      expect.objectContaining({ location: { kind: "tool", index: 0 }, owner: "instruction" }),
    )
    expect(partition.atoms).toContainEqual(
      expect.objectContaining({ location: { kind: "provider_instruction", index: 0 }, owner: "instruction" }),
    )

    const serialized = JSON.stringify(partition)
    for (const secret of [
      "system instruction secret",
      "user-role instruction secret",
      "ordinary context secret",
      "prior assistant context secret",
      "envelope secret",
      "sensitive-tool-name",
      "tool description secret",
      "provider instruction secret",
      "cGl4ZWxz",
    ]) {
      expect(serialized).not.toContain(secret)
    }
  })

  test("message envelopes exclude content payloads", () => {
    const first = buildProviderInputPartition({
      prompt: [{ role: "user", providerOptions: { trace: "same" }, content: "first content" }],
      tools: {},
      providerOptions: {},
      instructionLocators: [],
    })
    const second = buildProviderInputPartition({
      prompt: [{ role: "user", providerOptions: { trace: "same" }, content: "second content" }],
      tools: {},
      providerOptions: {},
      instructionLocators: [],
    })
    const firstEnvelope = first.atoms.find((atom) => atom.location.kind === "message_envelope")
    const secondEnvelope = second.atoms.find((atom) => atom.location.kind === "message_envelope")
    const firstContent = first.atoms.find((atom) => atom.location.kind === "message_content")
    const secondContent = second.atoms.find((atom) => atom.location.kind === "message_content")

    expect(firstEnvelope?.digest).toBe(secondEnvelope?.digest)
    expect(firstContent?.digest).not.toBe(secondContent?.digest)
  })

  test("decodes base64 only for explicitly typed media fields", () => {
    expect(commitProviderInputValue({ type: "file", data: "Zg==" }, "file").digest).toBe(
      commitProviderInputValue({ type: "file", data: "Zg" }, "file").digest,
    )
    expect(commitProviderInputValue({ type: "file", data: "Zg==" }, "file").digest).toBe(
      commitProviderInputValue({ type: "file", data: new Uint8Array([102]) }, "file").digest,
    )
    expect(commitProviderInputValue({ type: "image", image: "Zg==" }, "image").digest).toBe(
      commitProviderInputValue({ type: "image", image: new Uint8Array([102]) }, "image").digest,
    )
    expect(
      commitProviderInputValue({ type: "image", image: "https://example.invalid/image.png" }, "image").digest,
    ).toBe(
      commitProviderInputValue({ type: "image", image: new URL("https://example.invalid/image.png") }, "image").digest,
    )
    expect(commitProviderInputValue({ type: "file", data: "https://example.invalid/file.png" }, "file").digest).toBe(
      commitProviderInputValue({ type: "file", data: new URL("https://example.invalid/file.png") }, "file").digest,
    )
    expect(commitProviderInputValue({ type: "file", data: "data:text/plain;base64,Zg==" }, "file").digest).toBe(
      commitProviderInputValue({ type: "file", data: "data:text/plain,f" }, "file").digest,
    )
    expect(commitProviderInputValue("Zg==").digest).not.toBe(commitProviderInputValue("Zg").digest)
    expect(() => commitProviderInputValue({ type: "file", data: "not-base64!" }, "file")).toThrow(/typed media base64/i)
    expect(() => commitProviderInputValue(new Uint8Array([1, 2, 3]))).toThrow(/typed media fields/i)
    expect(commitProviderInputValue({ type: "image", image: new Uint8Array([1, 2, 3]) }, "image").digest).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    )
  })

  test("keeps media-shaped values inside ordinary tool JSON literal", () => {
    const toolCall = (data: string) => ({
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "custom",
      input: { type: "file", data },
    })
    expect(commitProviderInputValue(toolCall("Zg==")).digest).not.toBe(commitProviderInputValue(toolCall("Zg")).digest)
    expect(() => commitProviderInputValue(toolCall("ordinary text!"))).not.toThrow()
  })

  test("rejects unsupported object types instead of erasing their contents", () => {
    expect(() =>
      commitProviderInputValue({
        type: "text",
        text: "hello",
        providerOptions: { invalid: new Map([["a", 1]]) },
      }),
    ).toThrow(/unsupported provider input object type/i)
  })

  test("recomputed partition digests bind order, ownership, and atom commitments", () => {
    const partition = buildProviderInputPartition({
      prompt: [{ role: "user", content: ["one", "two"] }],
      tools: {},
      providerOptions: {},
      instructionLocators: [{ message: 0, part: 0 }],
    })
    const reordered = structuredClone(partition.atoms)
      .reverse()
      .map((atom, ordinal) => ({ ...atom, ordinal }))
    const reassigned = structuredClone(partition.atoms)
    reassigned[1]!.owner = reassigned[1]!.owner === "instruction" ? "context" : "instruction"
    const recommitted = structuredClone(partition.atoms)
    recommitted[1]!.digest = `sha256:${"0".repeat(64)}`

    expect(recomputeProviderInputPartitionDigest(reordered)).not.toBe(partition.digest)
    expect(recomputeProviderInputPartitionDigest(reassigned)).not.toBe(partition.digest)
    expect(recomputeProviderInputPartitionDigest(recommitted)).not.toBe(partition.digest)
  })
})

import { describe, test, expect } from "bun:test"
import { AntigravityDecoder, AntigravityProtocol, antigravityUserMessage } from "./antigravity-stream"

const usage = { input_tokens: 1, output_tokens: 1, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 2 }
const init = {
  event: "init" as const,
  conversation_id: "external-id",
  init: { cwd: "/checkout", model: "model", tools: [], permission_mode: "request-review" },
}
const result = (turn = 1) => ({
  event: "result" as const,
  result: {
    conversation_id: "external-id",
    status: "SUCCESS" as const,
    response: "hello",
    duration_seconds: turn,
    num_turns: turn,
    usage,
  },
})

describe("AGY official stream", () => {
  test("accepts typed soft-denial metadata without weakening result validation", () => {
    const wire = {
      ...result(),
      result: { ...result().result, denied_actions: [{ action: "command", display_name: "RunCommand" }] },
    }
    const [record] = new AntigravityDecoder().push(new TextEncoder().encode(JSON.stringify(wire) + "\n"))
    expect(record).toMatchObject({ result: { denied_actions: [{ action: "command", display_name: "RunCommand" }] } })
    const invalid = {
      ...wire,
      result: { ...wire.result, denied_actions: [{ action: "command", permission_granted: true }] },
    }
    expect(() => new AntigravityDecoder().push(new TextEncoder().encode(JSON.stringify(invalid) + "\n"))).toThrow()
  })
  test("decodes split UTF-8, multiple records and CRLF without corrupting text", () => {
    const decoder = new AntigravityDecoder()
    const bytes = new TextEncoder().encode(
      JSON.stringify({ ...result(), result: { ...result().result, response: "你好 🌍" } }) + "\r\n",
    )
    const records = [...bytes].flatMap((byte) => decoder.push(new Uint8Array([byte])))
    decoder.end()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ result: { response: "你好 🌍" } })
  })
  test("fails closed on unknown fields, records, malformed JSON, nesting and incomplete EOF", () => {
    for (const text of [
      "{}\n",
      '{"event":"future"}\n',
      "oops\n",
      JSON.stringify({ ...init, extra: true }) + "\n",
      "[".repeat(40) + "0" + "]".repeat(40) + "\n",
    ]) {
      expect(() => new AntigravityDecoder().push(new TextEncoder().encode(text))).toThrow()
    }
    const incomplete = new AntigravityDecoder()
    incomplete.push(new TextEncoder().encode(JSON.stringify(result())))
    expect(() => incomplete.end()).toThrow("incomplete")
    expect(() => new AntigravityDecoder().push(new Uint8Array([0xff]))).toThrow()
    expect(() => new AntigravityDecoder().push(new TextEncoder().encode("x".repeat(1024 * 1024 + 1)))).toThrow("limit")
  })
  test("binds multiple turns to one initialization and requires every result", () => {
    const protocol = new AntigravityProtocol({ cwd: "/checkout", model: "model" })
    protocol.beginTurn()
    protocol.accept(init)
    expect(() => protocol.end()).toThrow("terminal")
    protocol.accept(result())
    protocol.beginTurn()
    protocol.accept(result(2))
    protocol.end()
    expect(protocol.conversationID).toBe("external-id")
    expect(() => protocol.accept(result(2))).toThrow("unsolicited")
    expect(() => protocol.accept(init)).toThrow("duplicate")
  })
  test("rejects mismatched identity, selected configuration and non-success", () => {
    const protocol = new AntigravityProtocol({ cwd: "/checkout", model: "model" })
    expect(() => protocol.accept({ ...init, init: { ...init.init, cwd: "/main" } })).toThrow("checkout")
    protocol.beginTurn()
    protocol.accept(init)
    expect(() => protocol.accept({ ...result(), result: { ...result().result, conversation_id: "other" } })).toThrow(
      "identity",
    )
    expect(() => protocol.accept({ ...result(), result: { ...result().result, status: "WAITING" } })).toThrow("WAITING")
    expect(() => protocol.accept(result(3))).toThrow("counter")
  })
  test("serializes only supported text messages", () => {
    expect(JSON.parse(antigravityUserMessage('hello\n"world"'))).toEqual({
      event: "user",
      message: { content: 'hello\n"world"' },
    })
    expect(() => antigravityUserMessage("/model")).toThrow("slash")
    expect(() => antigravityUserMessage(" ")).toThrow()
  })
  test("official CLI tool ERROR is a recoverable observation, not a turn result", () => {
    const decoder = new AntigravityDecoder()
    const record = {
      event: "step_update",
      step_update: {
        conversation_id: "external-id",
        step_index: 1,
        state: "ERROR",
        step_type: "tool",
        tool_name: "write_to_file",
        tool_info: { name: "write_to_file", error: { type: "TOOL_ERROR", message: "invalid artifact path" } },
      },
    }
    const [parsed] = decoder.push(new TextEncoder().encode(JSON.stringify(record) + "\n"))
    const protocol = new AntigravityProtocol({ cwd: "/checkout", model: "model" })
    protocol.beginTurn()
    protocol.accept(init)
    protocol.accept(parsed)
    expect(() => protocol.end()).toThrow("terminal")
    protocol.accept(result())
    protocol.end()
    expect(() =>
      new AntigravityDecoder().push(
        new TextEncoder().encode(
          JSON.stringify({ ...record, step_update: { ...record.step_update, tool_info: undefined } }) + "\n",
        ),
      ),
    ).toThrow()
  })
})

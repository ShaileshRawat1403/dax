import { describe, expect, test } from "bun:test"
import { Storage } from "./storage"
import { Identifier } from "../id/id"

describe("storage key validation", () => {
  const traversal = [
    ["part", "prt_x", "../../../../.config/dax/dax"],
    ["todo", ".."],
    ["session", "proj", "a/b"],
    ["session", "proj", "a\\b"],
    ["session", ""],
    ["session", "."],
  ]

  for (const key of traversal) {
    test(`read rejects ${JSON.stringify(key)}`, async () => {
      await expect(Storage.read(key)).rejects.toBeInstanceOf(Storage.InvalidKeyError)
    })
    test(`write rejects ${JSON.stringify(key)}`, async () => {
      await expect(Storage.write(key, { a: 1 })).rejects.toBeInstanceOf(Storage.InvalidKeyError)
    })
  }

  test("remove and rename reject traversal", async () => {
    await expect(Storage.remove(["session", ".."])).rejects.toBeInstanceOf(Storage.InvalidKeyError)
    await expect(Storage.rename(["session", "a"], ["session", "../b"])).rejects.toBeInstanceOf(
      Storage.InvalidKeyError,
    )
  })

  test("list rejects traversal in the prefix", async () => {
    await expect(Storage.list(["session", ".."])).rejects.toBeInstanceOf(Storage.InvalidKeyError)
  })
})

describe("identifier schema", () => {
  test("rejects identifiers that could act as path segments", () => {
    const schema = Identifier.schema("session")
    expect(schema.safeParse("ses../../auth").success).toBe(false)
    expect(schema.safeParse("ses_a/b").success).toBe(false)
    expect(schema.safeParse("ses_a.b").success).toBe(false)
  })

  test("accepts generated and hand-minted identifiers", () => {
    const schema = Identifier.schema("session")
    expect(schema.safeParse(Identifier.ascending("session")).success).toBe(true)
    expect(schema.safeParse("ses_worker_1").success).toBe(true)
  })
})

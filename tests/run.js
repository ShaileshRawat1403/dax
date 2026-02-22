import { validatePlan } from "../core/validation/plan.js"
import { validateConfig } from "../core/validation/config.js"
import { recordEvent, verifyLedger } from "../core/ledger/index.js"
import { addNote, listNotes } from "../core/pm/index.js"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// validation tests
assert(validatePlan([{ permission: "tool.read" }]) === null, "valid plan")
assert(validatePlan({}) !== null, "invalid plan not array")
assert(validateConfig({ providers: ["openai"] }) === null, "valid config")
assert(validateConfig({ providers: [1] }) !== null, "invalid provider type")

// ledger integrity
const tmp = join(process.cwd(), ".dax-test")
rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })
recordEvent(tmp, { type: "run", payload: { a: 1 } })
recordEvent(tmp, { type: "audit", payload: { b: 2 } })
const result = verifyLedger(tmp)
assert(result.ok === true, "ledger verify")

// pm notes
addNote(tmp, { text: "hello", tags: ["a"], author: "me", source: "user" })
const notes = listNotes(tmp, 1)
assert(notes.length === 1, "pm add/list")

console.log("tests: ok")

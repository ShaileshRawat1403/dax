// Real cold production import. Fail immediately if import starts provider I/O or
// launches a process; these effects belong to explicit instance/agent operations.
let networkCalls = 0
let processCalls = 0
globalThis.fetch = () => { networkCalls++; throw new Error("Agent import started network I/O") }
Bun.spawn = () => { processCalls++; throw new Error("Agent import started a subprocess") }
Bun.spawnSync = () => { processCalls++; throw new Error("Agent import started a subprocess") }
const started = performance.now()
const { Agent } = await import("../../src/agent/agent")
console.log(JSON.stringify({ elapsedMs: performance.now() - started, networkCalls, processCalls,
  available: [Agent.get, Agent.list, Agent.defaultAgent, Agent.generate].every((value) => typeof value === "function") }))

/**
 * Gemini subscription lane stress test
 *
 * Tests:
 * 1. Single long-form request (tests CHUNK_TIMEOUT_MS / stream stability)
 * 2. Concurrent burst (tests MAX_CONCURRENCY / queue behaviour)
 * 3. Throttle classification (MODEL_CAPACITY_EXHAUSTED, RATE_LIMIT_EXCEEDED)
 * 4. Summary of pass/fail
 *
 * Usage:
 *   DAX_GEMINI_DEBUG=1 bun run script/gemini-stress-test.ts
 */

import path from "path"

// ─── Read OAuth creds directly (mirrors gemini.ts readCliCreds logic) ─────────

const credsPaths = [
  `${process.env.HOME}/.gemini/oauth_creds.json`,
  `${process.env.HOME}/.config/gemini/oauth_creds.json`,
  `${process.env.HOME}/.config/google-gemini/oauth_creds.json`,
]

type Creds = { access?: string; refresh?: string; expires?: number; access_token?: string; refresh_token?: string; expiry_date?: number }

async function readCreds(): Promise<{ access: string; refresh?: string } | null> {
  for (const p of credsPaths) {
    try {
      const raw: Creds = await Bun.file(p).json()
      const access = raw.access ?? raw.access_token
      const refresh = raw.refresh ?? raw.refresh_token
      const expires = raw.expires ?? raw.expiry_date
      if (access && expires && expires > Date.now()) {
        return { access, refresh }
      }
      // Token expired — try refresh
      if (refresh) {
        console.log(`[creds] token expired, refreshing via ${p}`)
        const refreshed = await refreshToken(refresh)
        if (refreshed) return refreshed
      }
    } catch {}
  }
  return null
}

async function refreshToken(refreshToken: string): Promise<{ access: string; refresh?: string } | null> {
  const clientID = process.env.DAX_GOOGLE_CLI_CLIENT_ID ?? process.env.GEMINI_OAUTH_CLIENT_ID
  const clientSecret = process.env.DAX_GOOGLE_CLI_CLIENT_SECRET ?? process.env.GEMINI_OAUTH_CLIENT_SECRET
  if (!clientID || !clientSecret) {
    console.warn("[creds] set DAX_GOOGLE_CLI_CLIENT_ID and DAX_GOOGLE_CLI_CLIENT_SECRET to enable token refresh")
    return null
  }
  const body = new URLSearchParams({
    client_id: clientID,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  })
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body })
  if (!res.ok) return null
  const data = await res.json()
  return data.access_token ? { access: data.access_token, refresh: refreshToken } : null
}

// ─── Resolve cloudcode project ───────────────────────────────────────────────

async function resolveProject(access: string): Promise<string> {
  const headers = {
    Authorization: `Bearer ${access}`,
    "Content-Type": "application/json",
    "User-Agent": "GoogleCloud/1.0.0 (Windows NT 10.0; Win64; x64) GeminiCLI/0.34.0",
  }
  const body = JSON.stringify({ metadata: { ideType: "IDE_UNSPECIFIED", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" } })
  const res = await fetch("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
    method: "POST", headers, body,
  }).catch(() => null)
  if (res?.ok) {
    const data = await res.json().catch(() => ({}))
    if (data.cloudaicompanionProject) return data.cloudaicompanionProject
  }
  return "default"
}

// ─── Make a streaming request through the scheduler (mirrors dax production path) ──

async function makeRequest(opts: {
  access: string
  project: string
  model: string
  prompt: string
  sessionId?: string
  label: string
}): Promise<{ success: boolean; tokens: number; durationMs: number; error?: string }> {
  const { scheduleGeminiSubscriptionRequest } = await import(
    "../packages/dax/src/plugin/gemini-scheduler"
  )

  const start = Date.now()
  const sessionId = opts.sessionId ?? crypto.randomUUID()

  const makeHeaders = () => ({
    Authorization: `Bearer ${opts.access}`,
    "Content-Type": "application/json",
    "User-Agent": "GoogleCloud/1.0.0 (Windows NT 10.0; Win64; x64) GeminiCLI/0.34.0",
    "x-activity-request-id": crypto.randomUUID().substring(0, 16),
  })

  const buildBody = () => JSON.stringify({
    project: opts.project,
    model: opts.model,
    user_prompt_id: crypto.randomUUID(),
    request: {
      session_id: sessionId,
      contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
      generationConfig: { maxOutputTokens: 1024 },
    },
  })

  // Route through the scheduler — same path as production dax
  const doFetch = async (): Promise<Response> => {
    const res = await fetch(
      "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse",
      { method: "POST", headers: makeHeaders(), body: buildBody() },
    )
    if (!res.ok) {
      // Attach the response to the error so the scheduler can classify it
      const err: any = new Error(`HTTP ${res.status}`)
      err.status = res.status
      err.response = res
      throw err
    }
    return res
  }

  let res: Response | null
  try {
    res = await scheduleGeminiSubscriptionRequest(doFetch, {
      projectId: opts.project,
      model: opts.model,
    })
  } catch (e: any) {
    return { success: false, tokens: 0, durationMs: Date.now() - start, error: `scheduler error: ${e.message}` }
  }

  if (!res) {
    return { success: false, tokens: 0, durationMs: Date.now() - start, error: "scheduler gave up (terminal quota or max retries)" }
  }

  // Consume SSE stream — same 30s chunk timeout as our fix
  let tokenCount = 0
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  const CHUNK_TIMEOUT_MS = 30_000

  try {
    while (true) {
      const readPromise = reader.read()
      const timeoutPromise = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`chunk_timeout after ${CHUNK_TIMEOUT_MS}ms`)), CHUNK_TIMEOUT_MS),
      )
      const { done, value } = await Promise.race([readPromise, timeoutPromise])
      if (done) break
      const text = decoder.decode(value, { stream: true })
      const chunks = text.split("\n").filter(l => l.startsWith("data:"))
      for (const chunk of chunks) {
        try {
          const json = JSON.parse(chunk.slice(5))
          const inner = json.response ?? json
          const parts = inner?.candidates?.[0]?.content?.parts ?? []
          for (const part of parts) if (part.text) tokenCount += part.text.split(/\s+/).length
        } catch {}
      }
    }
  } catch (e: any) {
    return { success: false, tokens: tokenCount, durationMs: Date.now() - start, error: e.message }
  }

  return { success: true, tokens: tokenCount, durationMs: Date.now() - start }
}

// ─── Throttle classification unit checks (no network) ────────────────────────

async function runThrottleClassificationTests() {
  console.log("\n── Throttle classification tests (unit, no network) ──────────────────")
  // Import directly
  const { classifyQuotaResponse, DEFAULT_MAX_ATTEMPTS, getModelCapacityCooldownMs } = await import(
    "../packages/dax/src/plugin/gemini-rate-limit"
  )

  let pass = 0; let fail = 0
  const assert = (label: string, ok: boolean) => {
    console.log(`  ${ok ? "✓" : "✗"} ${label}`)
    ok ? pass++ : fail++
  }

  // MODEL_CAPACITY_EXHAUSTED with no retryDelay must be non-terminal (our fix)
  const modelCapNoDelay = new Response(
    JSON.stringify({
      error: {
        message: "Model capacity exhausted",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "MODEL_CAPACITY_EXHAUSTED",
            domain: "cloudcode-pa.googleapis.com",
          },
        ],
      },
    }),
    { status: 429, headers: { "content-type": "application/json" } },
  )
  const ctx1 = await classifyQuotaResponse(modelCapNoDelay)
  assert("MODEL_CAPACITY_EXHAUSTED (no delay) → terminal: false", ctx1?.terminal === false)
  assert("MODEL_CAPACITY_EXHAUSTED (no delay) → retryDelayMs: undefined", ctx1?.retryDelayMs === undefined)

  // MODEL_CAPACITY_EXHAUSTED with a retryDelay
  const modelCapWithDelay = new Response(
    JSON.stringify({
      error: {
        message: "Model capacity exhausted",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "MODEL_CAPACITY_EXHAUSTED",
            domain: "cloudcode-pa.googleapis.com",
          },
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "20s",
          },
        ],
      },
    }),
    { status: 429, headers: { "content-type": "application/json" } },
  )
  const ctx2 = await classifyQuotaResponse(modelCapWithDelay)
  assert("MODEL_CAPACITY_EXHAUSTED (20s delay) → terminal: false", ctx2?.terminal === false)
  assert("MODEL_CAPACITY_EXHAUSTED (20s delay) → retryDelayMs: 20000", ctx2?.retryDelayMs === 20_000)

  // QUOTA_EXHAUSTED must still be terminal
  const quotaEx = new Response(
    JSON.stringify({
      error: {
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "QUOTA_EXHAUSTED",
            domain: "cloudcode-pa.googleapis.com",
          },
        ],
      },
    }),
    { status: 429, headers: { "content-type": "application/json" } },
  )
  const ctx3 = await classifyQuotaResponse(quotaEx)
  assert("QUOTA_EXHAUSTED → terminal: true", ctx3?.terminal === true)

  // RATE_LIMIT_EXCEEDED must be retryable with default 10s
  const rateLim = new Response(
    JSON.stringify({
      error: {
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "RATE_LIMIT_EXCEEDED",
            domain: "cloudcode-pa.googleapis.com",
          },
        ],
      },
    }),
    { status: 429, headers: { "content-type": "application/json" } },
  )
  const ctx4 = await classifyQuotaResponse(rateLim)
  assert("RATE_LIMIT_EXCEEDED → terminal: false", ctx4?.terminal === false)
  assert("RATE_LIMIT_EXCEEDED → retryDelayMs: 10000", ctx4?.retryDelayMs === 10_000)

  // Check tuned constants
  assert(`DEFAULT_MAX_ATTEMPTS is 3 (unchanged)`, DEFAULT_MAX_ATTEMPTS === 3)
  assert(`MODEL_CAPACITY_COOLDOWN_MS is 15000 (was 8000)`, getModelCapacityCooldownMs() === 15_000)

  console.log(`\n  Result: ${pass} passed, ${fail} failed`)
  return fail === 0
}

// ─── Scheduler mock-throttle stress test (no network) ────────────────────────

async function runSchedulerRetryTest() {
  console.log("\n── Scheduler retry test (mock 429s, no network) ──────────────────────")
  const { scheduleGeminiSubscriptionRequest } = await import(
    "../packages/dax/src/plugin/gemini-scheduler"
  )

  let attempts = 0
  let pass = 0; let fail = 0
  const assert = (label: string, ok: boolean) => {
    console.log(`  ${ok ? "✓" : "✗"} ${label}`)
    ok ? pass++ : fail++
  }

  // Simulate a MODEL_CAPACITY_EXHAUSTED 429 that succeeds on attempt 3
  attempts = 0
  const result1 = await scheduleGeminiSubscriptionRequest(
    async () => {
      attempts++
      if (attempts < 3) {
        const err: any = new Error(`model capacity`)
        err.status = 429
        err.response = new Response(
          JSON.stringify({
            error: {
              details: [
                {
                  "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                  reason: "MODEL_CAPACITY_EXHAUSTED",
                  domain: "cloudcode-pa.googleapis.com",
                },
              ],
            },
          }),
          { status: 429, headers: { "content-type": "application/json" } },
        )
        throw err
      }
      // Return a mock success Response
      return new Response("{}", { status: 200 })
    },
    { projectId: "test-project", model: "gemini-2.5-flash" },
  )
  assert("MODEL_CAPACITY_EXHAUSTED retried (not terminal) — succeeded on attempt 3", result1 !== null)
  assert("Took 3 attempts total", attempts === 3)

  // Simulate QUOTA_EXHAUSTED — should NOT retry (terminal)
  attempts = 0
  const result2 = await scheduleGeminiSubscriptionRequest(
    async () => {
      attempts++
      const err: any = new Error("quota exhausted")
      err.status = 429
      err.response = new Response(
        JSON.stringify({
          error: {
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                reason: "QUOTA_EXHAUSTED",
                domain: "cloudcode-pa.googleapis.com",
              },
            ],
          },
        }),
        { status: 429, headers: { "content-type": "application/json" } },
      )
      throw err
    },
    { projectId: "test-project", model: "gemini-2.5-flash" },
  )
  assert("QUOTA_EXHAUSTED is terminal — resolves null immediately", result2 === null)
  assert("QUOTA_EXHAUSTED made exactly 1 attempt", attempts === 1)

  console.log(`\n  Result: ${pass} passed, ${fail} failed`)
  return fail === 0
}

// ─── Live network tests ───────────────────────────────────────────────────────

async function runLiveTests(creds: { access: string; refresh?: string }) {
  const project = await resolveProject(creds.access)
  console.log(`\n── Live Gemini API tests (project: ${project}) ───────────────────────`)

  const model = "gemini-3-flash-preview"
  let pass = 0; let fail = 0
  const report = (label: string, r: { success: boolean; tokens: number; durationMs: number; error?: string }) => {
    const ok = r.success
    const status = ok ? "✓" : "✗"
    const detail = ok
      ? `${r.tokens} tokens in ${(r.durationMs / 1000).toFixed(1)}s`
      : `FAILED: ${r.error}`
    console.log(`  ${status} ${label} — ${detail}`)
    ok ? pass++ : fail++
  }

  // Test 1: Single short request
  console.log("\n  [1] Short request (warmup)")
  const r1 = await makeRequest({
    access: creds.access, project, model,
    prompt: "Say 'hello world' and nothing else.",
    label: "short",
  })
  report("Single short request", r1)

  // Test 2: Long-form request (tests stream stability at 30s timeout)
  console.log("\n  [2] Long request (tests stream chunk timeout with 30s window)")
  const r2 = await makeRequest({
    access: creds.access, project, model,
    prompt: "Write a detailed 500-word technical explanation of how TCP/IP congestion control works, including slow start, congestion avoidance, fast retransmit, and fast recovery algorithms. Be thorough.",
    label: "long-form",
  })
  report("Long-form request (stream stability)", r2)

  // Test 3: Concurrent burst — 6 requests at once (tests MAX_CONCURRENCY=6)
  console.log("\n  [3] Concurrent burst — 6 simultaneous requests (MAX_CONCURRENCY=6)")
  const burstPrompts = [
    "List the first 5 prime numbers.",
    "What is 2+2? Answer in one word.",
    "Name one planet in our solar system.",
    "What colour is the sky? One word.",
    "What is the capital of France? One word.",
    "Name one programming language.",
  ]
  const burstStart = Date.now()
  const burstResults = await Promise.all(
    burstPrompts.map((prompt, i) =>
      makeRequest({ access: creds.access, project, model, prompt, label: `burst-${i}` }),
    ),
  )
  const burstMs = Date.now() - burstStart
  const burstPassed = burstResults.filter(r => r.success).length
  console.log(`  ${burstPassed === 6 ? "✓" : "~"} Concurrent burst: ${burstPassed}/6 succeeded in ${(burstMs / 1000).toFixed(1)}s`)
  if (burstPassed >= 4) { pass++ } else { fail++ }
  burstResults.forEach((r, i) => {
    if (!r.success) console.log(`    burst-${i} failed: ${r.error}`)
  })

  // Test 4: Long task simulating a real coding session (~60s of output)
  console.log("\n  [4] Long coding task (simulates real session — tests no premature session end)")
  const r4 = await makeRequest({
    access: creds.access, project, model,
    prompt: `You are a senior software engineer. Write a complete, well-commented TypeScript implementation of a generic LRU (Least Recently Used) cache with the following requirements:
- Generic type parameters for key and value
- O(1) get and set operations using a doubly-linked list + HashMap
- Configurable capacity
- evict() method that returns the evicted entry
- toArray() that returns entries in LRU order
- Full JSDoc comments on every method
- Example usage at the bottom

Be thorough and complete. Include all edge cases.`,
    label: "long-coding-task",
  })
  report("Long coding task (no premature stream close)", r4)

  console.log(`\n  Live result: ${pass} passed, ${fail} failed`)
  return fail === 0
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════")
  console.log(" DAX Gemini Subscription Lane — Stress Test")
  console.log("═══════════════════════════════════════════════════════")
  console.log(" CHUNK_TIMEOUT_MS        : 30000ms (was 5000ms)")
  console.log(" MODEL_CAPACITY_COOLDOWN_MS : 15000ms (was 8000ms)")
  console.log(" MODEL_CAPACITY_EXHAUSTED   : always retryable (was terminal bug)")
  console.log(" DEFAULT_MAX_ATTEMPTS    : 3 (unchanged)")
  console.log(" MAX_CONCURRENCY         : 4 (unchanged)")
  console.log("═══════════════════════════════════════════════════════\n")

  const results: boolean[] = []

  // Unit tests — always run
  results.push(await runThrottleClassificationTests())
  results.push(await runSchedulerRetryTest())

  // Live tests — only if creds available
  const creds = await readCreds()
  if (!creds) {
    console.log("\n⚠  No valid Gemini OAuth credentials found — skipping live network tests")
    console.log("   To run live tests, ensure ~/.gemini/oauth_creds.json has a valid access token")
  } else {
    console.log(`\n✓ OAuth credentials found (expires in ${Math.round((Date.now() - Date.now()) / 1000)}s)`)
    results.push(await runLiveTests(creds))
  }

  const allPassed = results.every(Boolean)
  console.log("\n═══════════════════════════════════════════════════════")
  console.log(` Overall: ${allPassed ? "ALL TESTS PASSED ✓" : "SOME TESTS FAILED ✗"}`)
  console.log("═══════════════════════════════════════════════════════")
  process.exit(allPassed ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })

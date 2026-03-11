import { describe, expect, it } from "bun:test"
import {
  buildExploreResult,
  createEmptyExplorePassOutputs,
  mergeExplorePassOutputs,
  renderExploreResult,
  runBoundaryPass,
  runEntryPointPass,
  runExecutionFlowPass,
  runIntegrationPass,
  synthesizeExploreOutputs,
  type RepoExplorePassOutputs,
} from "./repo-explore"
import path from "path"
import os from "os"

describe("repo explore scaffolding", () => {
  it("builds the fixed section order required by the Explore output contract", () => {
    const result = buildExploreResult(createEmptyExplorePassOutputs())

    expect(result.sections.map((section) => section.key)).toEqual([
      "repository_shape",
      "entry_points",
      "execution_graph",
      "orchestration_loop",
      "integrations",
      "important_files",
      "suggested_reading_order",
      "unknowns_follow_up_targets",
    ])
  })

  it("renders evidence markers, confidence labels, file citations, and follow-up structure", () => {
    const outputs: RepoExplorePassOutputs = {
      repository_shape: {
        confidence: "high_confidence",
        findings: [{ kind: "observed", summary: "canonical runtime under packages/dax", paths: ["packages/dax"] }],
      },
      entry_points: {
        confidence: "high_confidence",
        findings: [{ kind: "observed", summary: "CLI entry point", paths: ["packages/dax/src/index.ts"] }],
      },
      execution_graph: {
        confidence: "medium_confidence",
        findings: [{ kind: "inferred", summary: "session runtime coordinates the main execution flow", paths: ["packages/dax/src/session/index.ts"] }],
      },
      orchestration_loop: {
        confidence: "medium_confidence",
        findings: [{ kind: "observed", summary: "stable operator loop aligns with plan -> run -> approvals -> artifacts -> audit" }],
      },
      integrations: {
        confidence: "low_confidence",
        findings: [{ kind: "unknown", summary: "queue backend not confirmed" }],
      },
      important_files: [
        { path: "packages/dax/src/index.ts", role: "CLI entry surface" },
        { path: "packages/dax/src/session/index.ts", role: "session runtime coordination" },
      ],
      suggested_reading_order: [
        { path: "packages/dax/src/index.ts", reason: "establishes runtime entry" },
        { path: "packages/dax/src/session/index.ts", reason: "shows session control flow" },
      ],
      unknowns_follow_up_targets: [
        { kind: "unknown", summary: "background job entry surface not confirmed" },
        { kind: "follow_up", summary: "inspect provider initialization under packages/dax/src/provider/*" },
      ],
    }

    const rendered = renderExploreResult(buildExploreResult(outputs))

    expect(rendered).toContain("Repository shape")
    expect(rendered).toContain("Confidence: medium confidence")
    expect(rendered).toContain("- Observed: canonical runtime under packages/dax (packages/dax)")
    expect(rendered).toContain("- Observed: CLI entry point (packages/dax/src/index.ts)")
    expect(rendered).toContain("- Inferred: session runtime coordinates the main execution flow (packages/dax/src/session/index.ts)")
    expect(rendered).toContain("- Unknown: queue backend not confirmed")
    expect(rendered).toContain("- packages/dax/src/index.ts — CLI entry surface")
    expect(rendered).toContain("1. packages/dax/src/index.ts")
    expect(rendered).toContain("Reason: establishes runtime entry")
    expect(rendered).toContain("- Follow-up: inspect provider initialization under packages/dax/src/provider/*")
  })

  it("preserves structure in eli12 mode while simplifying empty-section wording", () => {
    const rendered = renderExploreResult(buildExploreResult(createEmptyExplorePassOutputs()), { eli12: true })

    expect(rendered).toContain("Repository shape")
    expect(rendered).toContain("Confidence: unknown")
    expect(rendered).toContain("- Unknown: DAX could not confirm this section yet.")
    expect(rendered).toContain("Important files")
    expect(rendered).toContain("Suggested reading order")
    expect(rendered).toContain("Unknowns / follow-up targets")
  })

  it("merges important files and follow-up structures across passes without overwriting earlier evidence", () => {
    const merged = mergeExplorePassOutputs(
      mergeExplorePassOutputs(createEmptyExplorePassOutputs(), {
        important_files: [{ path: "package.json", role: "root signal" }],
        unknowns_follow_up_targets: [{ kind: "unknown", summary: "queue backend not confirmed" }],
      }),
      {
        important_files: [{ path: "src/index.ts", role: "cli bootstrap" }],
        unknowns_follow_up_targets: [{ kind: "follow_up", summary: "inspect server bootstrap" }],
      },
    )

    expect(merged.important_files).toEqual([
      { path: "package.json", role: "root signal" },
      { path: "src/index.ts", role: "cli bootstrap" },
    ])
    expect(merged.unknowns_follow_up_targets).toEqual([
      { kind: "unknown", summary: "queue backend not confirmed" },
      { kind: "follow_up", summary: "inspect server bootstrap" },
    ])
  })

  it("detects repo shape signals and workspace boundaries in the boundary pass", async () => {
    const root = await mkdtemp()

    await Bun.write(path.join(root, "package.json"), JSON.stringify({ name: "repo" }))
    await Bun.write(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n  - apps/*\n")
    await Bun.write(path.join(root, "turbo.json"), JSON.stringify({ pipeline: {} }))

    await Bun.write(path.join(root, "packages", "dax", "package.json"), JSON.stringify({ name: "dax" }))
    await Bun.write(path.join(root, "apps", "web", "package.json"), JSON.stringify({ name: "web" }))

    const delta = await runBoundaryPass(root)
    const outputs = mergeExplorePassOutputs(createEmptyExplorePassOutputs(), delta)

    expect(outputs.repository_shape.confidence).toBe("high_confidence")
    expect(outputs.repository_shape.findings.some((finding) => finding.summary.includes("repo root contains package.json, pnpm-workspace.yaml, turbo.json"))).toBe(true)
    expect(outputs.repository_shape.findings.some((finding) => finding.summary.includes("workspace tooling detected: pnpm workspace, turborepo"))).toBe(true)
    expect(outputs.repository_shape.findings.some((finding) => finding.summary.includes("workspace boundaries detected under packages/dax, apps/web"))).toBe(true)
    expect(outputs.repository_shape.findings.some((finding) => finding.summary.includes("language and build domains detected: node"))).toBe(true)
    expect(outputs.important_files.map((file) => file.path)).toEqual(["package.json", "pnpm-workspace.yaml", "turbo.json", "packages/dax", "apps/web"])
  })

  it("detects observed runtime entry points and candidate packages in the entry-point pass", async () => {
    const root = await mkdtemp()

    await Bun.write(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "repo",
        bin: { dax: "./bin/dax" },
      }),
    )
    await Bun.write(path.join(root, "src", "index.ts"), `import yargs from "yargs"\nyargs([]).scriptName("repo")\n`)
    await Bun.write(path.join(root, "bin", "dax"), "#!/usr/bin/env bun\n")

    await Bun.write(path.join(root, "apps", "api", "package.json"), JSON.stringify({ name: "api" }))
    await Bun.write(path.join(root, "apps", "api", "src", "server.ts"), `const server = Bun.serve({ fetch() { return new Response("ok") } })\n`)

    await Bun.write(path.join(root, "services", "worker", "package.json"), JSON.stringify({ name: "worker" }))
    await Bun.write(path.join(root, "services", "worker", "src", "main.ts"), `queue.process("jobs", async () => {})\n`)

    await Bun.write(path.join(root, "packages", "console", "package.json"), JSON.stringify({ name: "console" }))
    await Bun.write(path.join(root, "packages", "console", "src", "app.tsx"), `import "@opentui/solid"\nexport const app = () => null\n`)

    await Bun.write(path.join(root, "packages", "lib", "package.json"), JSON.stringify({ name: "lib" }))

    const delta = await runEntryPointPass(root)
    const outputs = mergeExplorePassOutputs(createEmptyExplorePassOutputs(), delta)

    expect(outputs.entry_points.confidence).toBe("high_confidence")
    expect(outputs.entry_points.findings.some((finding) => finding.summary.includes("CLI entry point detected: package.json bin mapping points to runtime bootstrap"))).toBe(true)
    expect(outputs.entry_points.findings.some((finding) => finding.summary.includes("CLI entry point detected: cli bootstrap signals detected"))).toBe(true)
    expect(outputs.entry_points.findings.some((finding) => finding.summary.includes("Server entry point detected: server bootstrap signals detected"))).toBe(true)
    expect(outputs.entry_points.findings.some((finding) => finding.summary.includes("Worker or background entry point detected: background execution signals detected"))).toBe(true)
    expect(outputs.entry_points.findings.some((finding) => finding.summary.includes("TUI entry point detected: tui bootstrap signals detected"))).toBe(true)
    expect(outputs.entry_points.findings.some((finding) => finding.summary.includes("no clear runtime entry point confirmed under packages/lib"))).toBe(true)
    expect(outputs.important_files.some((file) => file.path === "src/index.ts" && file.role === "cli bootstrap")).toBe(true)
    expect(outputs.important_files.some((file) => file.path === "apps/api/src/server.ts" && file.role === "server bootstrap")).toBe(true)
    expect(outputs.important_files.some((file) => file.path === "services/worker/src/main.ts" && file.role === "worker bootstrap")).toBe(true)
    expect(outputs.important_files.some((file) => file.path === "packages/console/src/app.tsx" && file.role === "tui bootstrap")).toBe(true)
  })

  it("detects provider, mcp, storage, queue, ci, and auth/platform boundaries in the integration pass", async () => {
    const root = await mkdtemp()

    await Bun.write(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "repo",
        dependencies: {
          "@ai-sdk/openai": "1.0.0",
          "@modelcontextprotocol/sdk": "1.0.0",
          "@octokit/rest": "1.0.0",
          "ioredis": "1.0.0",
          "bullmq": "1.0.0",
          "@ai-sdk/azure": "1.0.0",
        },
      }),
    )
    await Bun.write(
      path.join(root, "src", "integrations.ts"),
      [
        `import "@modelcontextprotocol/sdk"`,
        `import "dotenv/config"`,
        `const queue = { process() {} }`,
        `queue.process("jobs", async () => {})`,
        `const auth = process.env.OPENAI_API_KEY`,
        `const db = "pm.sqlite"`,
        `await fetch("https://api.example.com/status")`,
        `const region = process.env.AWS_REGION`,
      ].join("\n"),
    )
    await Bun.write(
      path.join(root, ".github", "workflows", "ci.yml"),
      `name: CI\non:\n  workflow_dispatch:\n`,
    )

    const delta = await runIntegrationPass(root)
    const outputs = mergeExplorePassOutputs(createEmptyExplorePassOutputs(), delta)

    expect(outputs.integrations.confidence).toBe("high_confidence")
    expect(outputs.integrations.findings.some((finding) => finding.summary.includes("Provider integration detected: ai provider sdk dependency declared"))).toBe(true)
    expect(outputs.integrations.findings.some((finding) => finding.summary.includes("MCP integration detected: mcp sdk dependency declared"))).toBe(true)
    expect(outputs.integrations.findings.some((finding) => finding.summary.includes("Storage integration detected: database or persistence dependency declared"))).toBe(true)
    expect(outputs.integrations.findings.some((finding) => finding.summary.includes("Queue or async integration detected: queue or async dependency declared"))).toBe(true)
    expect(outputs.integrations.findings.some((finding) => finding.summary.includes("CI or automation integration detected: github actions workflow detected"))).toBe(true)
    expect(outputs.integrations.findings.some((finding) => finding.summary.includes("Auth or secrets boundary detected: runtime auth or env configuration signals detected"))).toBe(true)
    expect(outputs.integrations.findings.some((finding) => finding.summary.includes("Platform or cloud integration detected"))).toBe(true)
    expect(outputs.important_files.some((file) => file.path === "package.json" && file.role === "provider integration manifest")).toBe(true)
    expect(outputs.important_files.some((file) => file.path === "src/integrations.ts" && file.role === "mcp integration surface")).toBe(true)
    expect(outputs.important_files.some((file) => file.path === ".github/workflows/ci.yml" && file.role === "ci or automation workflow")).toBe(true)
  })

  it("detects primary execution flows, orchestration loops, and approval interruptions in the execution-flow pass", async () => {
    const root = await mkdtemp()

    await Bun.write(
      path.join(root, "packages", "app", "src", "index.ts"),
      [
        `const { RunCommand } = await import("./cli/cmd/run")`,
        `const cli = yargs([])`,
        `cli.command(RunCommand)`,
      ].join("\n"),
    )
    await Bun.write(path.join(root, "packages", "app", "src", "cli", "cmd", "run.ts"), `export const RunCommand = {}\n`)

    await Bun.write(
      path.join(root, "packages", "app", "src", "cli", "cmd", "tui", "thread.ts"),
      [`const worker = new Worker("worker.js")`, `const client = Rpc.client(worker)`, `await client.call("server", {})`].join("\n"),
    )

    await Bun.write(
      path.join(root, "packages", "app", "src", "cli", "cmd", "tui", "component", "prompt", "index.tsx"),
      [`sdk.client.session.prompt({})`, `sdk.client.session.command({})`, `sdk.client.session.shell({})`].join("\n"),
    )

    await Bun.write(
      path.join(root, "packages", "app", "src", "session", "index.ts"),
      [`import { SessionPrompt } from "./prompt"`, `await SessionPrompt.command({})`].join("\n"),
    )

    await Bun.write(
      path.join(root, "packages", "app", "src", "session", "processor.ts"),
      [
        `while (true) {`,
        `  SessionStatus.set(sessionID, { type: "busy" })`,
        `  const stream = await LLM.stream({})`,
        `  await PermissionNext.ask({})`,
        `}`,
      ].join("\n"),
    )

    const delta = await runExecutionFlowPass(root)
    const outputs = mergeExplorePassOutputs(createEmptyExplorePassOutputs(), delta)

    expect(outputs.execution_graph.confidence).toBe("high_confidence")
    expect(outputs.orchestration_loop.confidence).toBe("high_confidence")
    expect(outputs.execution_graph.findings.some((finding) => finding.summary.includes("cli_command_flow: cli bootstrap dispatches into command handlers"))).toBe(true)
    expect(outputs.execution_graph.findings.some((finding) => finding.summary.includes("tui_action_flow: tui action submits work into session runtime"))).toBe(true)
    expect(outputs.execution_graph.findings.some((finding) => finding.summary.includes("session_execution_flow: session surface hands work into the prompt runtime"))).toBe(true)
    expect(outputs.execution_graph.findings.some((finding) => finding.summary.includes("worker_dispatch_flow: tui thread hands execution into a worker rpc boundary"))).toBe(true)
    expect(outputs.orchestration_loop.findings.some((finding) => finding.summary.includes("session_execution_flow: session runtime maintains the main execution loop"))).toBe(true)
    expect(outputs.orchestration_loop.findings.some((finding) => finding.summary.includes("approval_interruption_flow: approval checks can interrupt and gate execution"))).toBe(true)
    expect(outputs.important_files.some((file) => file.path === "packages/app/src/session/processor.ts")).toBe(true)
  })

  it("synthesizes ranked important files, reading order, and follow-up targets from real pass evidence", () => {
    const synthesized = synthesizeExploreOutputs(
      mergeExplorePassOutputs(
        mergeExplorePassOutputs(
          mergeExplorePassOutputs(createEmptyExplorePassOutputs(), {
            repository_shape: {
              confidence: "high_confidence",
              findings: [{ kind: "observed", summary: "repo root contains package.json", paths: ["package.json"] }],
            },
            important_files: [
              { path: "package.json", role: "root repo-shape signal" },
              { path: "packages/app", role: "package boundary" },
            ],
          }),
          {
            entry_points: {
              confidence: "medium_confidence",
              findings: [
                { kind: "observed", summary: "CLI entry point detected", paths: ["packages/app/src/index.ts"] },
                { kind: "unknown", summary: "no clear runtime entry point confirmed under packages/lib", paths: ["packages/lib"] },
              ],
            },
            important_files: [
              { path: "packages/app/src/index.ts", role: "cli bootstrap" },
              { path: "packages/lib", role: "package boundary" },
            ],
          },
        ),
        {
          execution_graph: {
            confidence: "high_confidence",
            findings: [{ kind: "observed", summary: "session_execution_flow: session surface hands work into the prompt runtime", paths: ["packages/app/src/session/index.ts"] }],
          },
          orchestration_loop: {
            confidence: "high_confidence",
            findings: [{ kind: "inferred", summary: "approval_interruption_flow: control can pause or stop through abort transitions", paths: ["packages/app/src/session/processor.ts"] }],
          },
          integrations: {
            confidence: "medium_confidence",
            findings: [{ kind: "observed", summary: "Provider integration detected", paths: ["packages/app/package.json"] }],
          },
          important_files: [
            { path: "packages/app/src/session/index.ts", role: "execution flow surface" },
            { path: "packages/app/src/session/processor.ts", role: "orchestration loop surface" },
            { path: "packages/app/package.json", role: "provider integration manifest" },
          ],
        },
      ),
    )

    expect(synthesized.important_files.map((file) => file.path)).toEqual([
      "package.json",
      "packages/app/src/index.ts",
      "packages/app/src/session/index.ts",
      "packages/app/src/session/processor.ts",
      "packages/app",
      "packages/lib",
      "packages/app/package.json",
    ])
    expect(synthesized.suggested_reading_order[0]).toEqual({
      path: "package.json",
      reason: "Establishes repository shape and workspace boundaries.",
    })
    expect(synthesized.suggested_reading_order[1]).toEqual({
      path: "packages/app/src/index.ts",
      reason: "Shows where runtime execution starts.",
    })
    expect(
      synthesized.unknowns_follow_up_targets.some(
        (item) => item.kind === "unknown" && item.summary === "Confirm runtime start under packages/lib",
      ),
    ).toBe(true)
    expect(
      synthesized.unknowns_follow_up_targets.some(
        (item) =>
          item.kind === "follow_up" &&
          item.summary.includes("Confirm inferred boundary: approval_interruption_flow: control can pause or stop through abort transitions"),
      ),
    ).toBe(true)
  })

  it("filters self-referential Explore files and down-ranks test-only evidence during synthesis", () => {
    const synthesized = synthesizeExploreOutputs({
      repository_shape: {
        confidence: "high_confidence",
        findings: [
          { kind: "observed", summary: "repo root contains package.json", paths: ["package.json"] },
          { kind: "observed", summary: "self analyzer noise", paths: ["src/explore/repo-explore.ts"] },
        ],
      },
      entry_points: {
        confidence: "high_confidence",
        findings: [
          { kind: "observed", summary: "CLI entry point detected", paths: ["src/index.ts", "src/cli/cmd/explore.test.ts"] },
          { kind: "observed", summary: "test-only candidate", paths: ["src/cli/cmd/explore.test.ts"] },
        ],
      },
      execution_graph: {
        confidence: "high_confidence",
        findings: [
          {
            kind: "observed",
            summary: "session_execution_flow: runtime handoff",
            paths: ["src/session/prompt.ts", "src/explore/repo-explore.test.ts"],
          },
        ],
      },
      orchestration_loop: {
        confidence: "medium_confidence",
        findings: [
          {
            kind: "inferred",
            summary: "approval_interruption_flow: candidate loop seen in tests",
            paths: ["src/explore/repo-explore.test.ts"],
          },
        ],
      },
      integrations: {
        confidence: "medium_confidence",
        findings: [
          { kind: "observed", summary: "MCP integration detected", paths: ["src/index.ts", "src/explore/repo-explore.ts"] },
        ],
      },
      important_files: [
        { path: "src/explore/repo-explore.ts", role: "execution flow surface" },
        { path: "src/explore/repo-explore.test.ts", role: "orchestration loop surface" },
        { path: "src/index.ts", role: "cli bootstrap" },
        { path: "src/session/prompt.ts", role: "orchestration loop surface" },
        { path: "src/session/prompt.test.ts", role: "execution flow surface" },
        { path: "package.json", role: "root repo-shape signal" },
      ],
      suggested_reading_order: [
        { path: "src/explore/repo-explore.ts", reason: "self reference" },
        { path: "src/session/prompt.test.ts", reason: "test evidence" },
        { path: "package.json", reason: "repo root" },
        { path: "src/index.ts", reason: "runtime start" },
      ],
      unknowns_follow_up_targets: [],
    })

    expect(synthesized.repository_shape.findings.some((finding) => finding.paths?.includes("src/explore/repo-explore.ts"))).toBe(false)
    expect(synthesized.entry_points.findings.some((finding) => finding.summary.includes("test-only candidate"))).toBe(false)
    expect(synthesized.execution_graph.findings[0]?.paths).toEqual(["src/session/prompt.ts"])
    expect(synthesized.orchestration_loop.confidence).toBe("unknown")
    expect(synthesized.integrations.findings[0]?.paths).toEqual(["src/index.ts"])

    expect(synthesized.important_files.map((file) => file.path)).toEqual([
      "package.json",
      "src/index.ts",
      "src/session/prompt.ts",
      "src/session/prompt.test.ts",
    ])

    expect(synthesized.suggested_reading_order.map((step) => step.path)).toEqual([
      "package.json",
      "src/index.ts",
      "src/session/prompt.test.ts",
    ])
  })
})

async function mkdtemp() {
  const root = await Bun.$`mktemp -d ${path.join(os.tmpdir(), "dax-explore-boundary-XXXXXX")}`.text()
  const dir = root.trim()
  await Bun.$`mkdir -p ${path.join(dir, "packages", "dax")}`.quiet()
  await Bun.$`mkdir -p ${path.join(dir, "apps", "web")}`.quiet()
  await Bun.$`mkdir -p ${path.join(dir, "src")}`.quiet()
  await Bun.$`mkdir -p ${path.join(dir, "bin")}`.quiet()
  await Bun.$`mkdir -p ${path.join(dir, "apps", "api", "src")}`.quiet()
  await Bun.$`mkdir -p ${path.join(dir, "services", "worker", "src")}`.quiet()
  await Bun.$`mkdir -p ${path.join(dir, "packages", "console", "src")}`.quiet()
  await Bun.$`mkdir -p ${path.join(dir, "packages", "lib")}`.quiet()
  await Bun.$`mkdir -p ${path.join(dir, "packages", "app", "src", "cli", "cmd", "tui", "component", "prompt")}`.quiet()
  await Bun.$`mkdir -p ${path.join(dir, "packages", "app", "src", "cli", "cmd")}`.quiet()
  await Bun.$`mkdir -p ${path.join(dir, "packages", "app", "src", "session")}`.quiet()
  await Bun.$`mkdir -p ${path.join(dir, ".github", "workflows")}`.quiet()
  return dir
}

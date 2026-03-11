import path from "path"
import { exploreRepository, renderExploreResult, type RepoExploreResult } from "./repo-explore"

export type ExploreOutputFormat = "table" | "json"

export type ExploreOperatorInput = {
  baseDir: string
  pathArg?: string
  format?: ExploreOutputFormat
  eli12?: boolean
}

export type ExploreOperatorResult = {
  target: string
  format: ExploreOutputFormat
  eli12: boolean
  result: RepoExploreResult
  rendered: string
}

export function parseExploreArguments(args: string) {
  const tokens = args.match(/(?:"[^"]*"|'[^']*'|[^\s"']+)/g) ?? []
  let pathArg: string | undefined
  let eli12 = false
  let format: ExploreOutputFormat = "table"

  for (const rawToken of tokens) {
    const token = rawToken.replace(/^["']|["']$/g, "")
    if (token === "--eli12") {
      eli12 = true
      continue
    }
    if (token.startsWith("--format=")) {
      const value = token.slice("--format=".length)
      if (value === "json" || value === "table") format = value
      continue
    }
    if (token === "--json") {
      format = "json"
      continue
    }
    if (!pathArg) pathArg = token
  }

  return {
    pathArg,
    eli12,
    format,
  }
}

export async function runExploreOperator(input: ExploreOperatorInput): Promise<ExploreOperatorResult> {
  const format = input.format ?? "table"
  const eli12 = Boolean(input.eli12)
  const target = path.resolve(input.baseDir, input.pathArg ?? ".")
  const result = await exploreRepository(target)
  const rendered = format === "json" ? JSON.stringify(result, null, 2) : renderExploreResult(result, { eli12 })

  return {
    target,
    format,
    eli12,
    result,
    rendered,
  }
}

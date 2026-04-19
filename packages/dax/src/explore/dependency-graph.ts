import path from "path"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"

const log = Log.create({ service: "dependency-graph" })

export type DepNode = {
  path: string
  label: string
  dependencies: string[]
}

export type DepGraph = {
  nodes: Record<string, DepNode>
  entryPoints: string[]
}

export async function generateDependencyGraph(root: string): Promise<DepGraph> {
  const resolvedRoot = path.resolve(root)
  const nodes: Record<string, DepNode> = {}
  const entryPoints: string[] = []

  // Simplify: focus on src/ directories and top-level entry points
  const glob = new Bun.Glob("{src,packages/*/src}/**/*.{ts,tsx}")
  const files = await Array.fromAsync(glob.scan({ cwd: resolvedRoot, absolute: true }))

  for (const file of files) {
    const relativePath = path.relative(resolvedRoot, file).replace(/\\/g, "/")
    const content = await Bun.file(file).text()
    const imports = extractImportSpecifiers(content)
    
    const resolvedImports = await Promise.all(
      imports.map(async (spec) => {
        if (spec.startsWith(".")) {
          const resolved = await resolveRelativeImport(file, spec)
          return resolved ? path.relative(resolvedRoot, resolved).replace(/\\/g, "/") : undefined
        }
        // Could also resolve workspace packages here if needed
        return undefined
      })
    )

    nodes[relativePath] = {
      path: relativePath,
      label: path.basename(relativePath),
      dependencies: resolvedImports.filter(Boolean) as string[],
    }

    if (isLikelyEntryPoint(relativePath, content)) {
      entryPoints.push(relativePath)
    }
  }

  return { nodes, entryPoints }
}

function extractImportSpecifiers(content: string) {
  const specifiers: string[] = []
  const patterns = [/import\s+(?:[^'"]+?\s+from\s+)?["']([^"']+)["']/g, /await\s+import\(["']([^"']+)["']\)/g]
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) specifiers.push(match[1])
    }
  }
  return specifiers
}

async function resolveRelativeImport(baseFile: string, specifier: string) {
  const baseDir = path.dirname(baseFile)
  const extensions = [".ts", ".tsx", ".js", ".jsx"]
  const candidates = [
    path.resolve(baseDir, specifier),
    ...extensions.map(ext => path.resolve(baseDir, specifier + ext)),
    ...extensions.map(ext => path.resolve(baseDir, specifier, "index" + ext)),
  ]

  for (const candidate of candidates) {
    if (await Filesystem.exists(candidate)) return candidate
  }
  return undefined
}

function isLikelyEntryPoint(relativePath: string, content: string) {
  const lower = content.toLowerCase()
  return (
    lower.includes("bun.serve(") ||
    lower.includes("yargs") ||
    lower.includes("commander") ||
    lower.includes("import { cmd }") ||
    relativePath.endsWith("index.ts") ||
    relativePath.endsWith("main.ts") ||
    relativePath.endsWith("app.tsx")
  )
}

export function renderDependencyGraph(graph: DepGraph): string {
  const lines: string[] = ["", "  DAX Dependency Graph", "  " + "━".repeat(20), ""]
  const visited = new Set<string>()

  function printNode(nodePath: string, indent: string = "  ", isLast: boolean = true) {
    if (visited.has(nodePath)) {
      lines.push(`${indent}${isLast ? "╰─" : "├─"} ${path.basename(nodePath)} (recursive)`)
      return
    }
    visited.add(nodePath)
    
    const node = graph.nodes[nodePath]
    if (!node) return

    lines.push(`${indent}${isLast ? "╰─" : "├─"} ${node.label}`)
    
    const childIndent = indent + (isLast ? "   " : "│  ")
    const deps = node.dependencies.filter(d => graph.nodes[d])
    
    deps.forEach((dep, i) => {
      printNode(dep, childIndent, i === deps.length - 1)
    })
  }

  if (graph.entryPoints.length === 0) {
    // Fallback to top-level nodes if no entry points found
    const rootNodes = Object.keys(graph.nodes).slice(0, 5)
    rootNodes.forEach((node, i) => printNode(node, "  ", i === rootNodes.length - 1))
  } else {
    graph.entryPoints.slice(0, 5).forEach((entry, i) => {
      printNode(entry, "  ", i === graph.entryPoints.length - 1)
    })
  }

  return lines.join("\n")
}

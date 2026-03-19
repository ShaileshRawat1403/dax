import path from "path"
import fs from "fs/promises"
import type { ArtifactRecord } from "../governance/artifact"

export async function writeWorkflowArtifact(input: {
  cwd: string
  sessionId: string
  taskId: string
  producingOperator: string
  type: ArtifactRecord["type"]
  filename: string
  description: string
  payload: unknown
  timestamp?: string
}) {
  const timestamp = input.timestamp ?? new Date().toISOString()
  const dir = path.join(input.cwd, ".dax", "artifacts", input.sessionId)
  await fs.mkdir(dir, { recursive: true })
  const filepath = path.join(dir, input.filename)
  await fs.writeFile(filepath, JSON.stringify(input.payload, null, 2))

  const artifact: ArtifactRecord = {
    id: `${input.type}-${Date.now()}`,
    sessionId: input.sessionId,
    taskId: input.taskId,
    producingOperator: input.producingOperator,
    type: input.type,
    description: input.description,
    path: filepath,
    timestamp,
  }

  return { artifact, filepath, timestamp }
}

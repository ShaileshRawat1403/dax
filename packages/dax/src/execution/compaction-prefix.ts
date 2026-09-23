import { createHash } from "node:crypto"

export function commitCompactionPrefix(messageIds: string[]) {
  return {
    canonicalization: "ordered-message-ids-v1" as const,
    digest: `sha256:${createHash("sha256").update(JSON.stringify(messageIds), "utf8").digest("hex")}`,
    messageIds: [...messageIds],
  }
}

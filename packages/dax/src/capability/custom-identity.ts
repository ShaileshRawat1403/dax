import { createHash } from "node:crypto"
import { createCapabilityRegistry } from "./registry"
import { CapabilityIdentityError } from "./dynamic-identity"

export const CUSTOM_TOOL_NAMESPACE = "custom.tool.v1."
export const CUSTOM_OPERATOR_NAMESPACE = "custom.operator.v1."

/** Logical registration identity only: no origin, code attestation or authority. */
export function customCapability(kind: "tool" | "operator", name: string) {
  if (typeof name !== "string" || !name || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(name)) {
    throw new CapabilityIdentityError("malformed")
  }
  const bytes = Buffer.from(name, "utf8")
  const digest = createHash("sha256").update(`dax.custom.${kind}.v1\0`).update(`${bytes.length}:`).update(bytes).digest("hex")
  return createCapabilityRegistry([{
    id: `${kind === "tool" ? CUSTOM_TOOL_NAMESPACE : CUSTOM_OPERATOR_NAMESPACE}c${digest}`,
    riskClass: "high", scopeSupport: "opaque", requiresVerification: true,
  }]).list()[0]
}

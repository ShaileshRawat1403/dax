import { describe, expect, test } from "bun:test"
import { Wildcard } from "../util/wildcard"
import { ATTACHMENT_PATH_RULES } from "./prompt"

const blocked = (p: string) => Wildcard.all(p, ATTACHMENT_PATH_RULES) !== "allow"

describe("attachment path rules", () => {
  test("blocks the paths the old text/plain-only regex covered", () => {
    for (const p of [
      "/home/u/proj/.env",
      "/home/u/proj/.env.local",
      "/home/u/.ssh/id_rsa",
      "/home/u/.ssh/known_hosts",
      "/home/u/.npmrc",
      "/home/u/.aws/credentials",
    ])
      expect(blocked(p)).toBe(true)
  })

  test("blocks what the old regex missed", () => {
    for (const p of [
      "/home/u/certs/server.pem",
      "/home/u/certs/server.key",
      "/home/u/certs/bundle.p12",
      "/home/u/.ssh/id_ecdsa",
      "/home/u/.local/share/dax/auth.json",
      "/home/u/.netrc",
      "/home/u/.kube/config",
      "/home/u/.docker/config.json",
      "/home/u/proj/my-secrets.txt",
    ])
      expect(blocked(p)).toBe(true)
  })

  test("allows ordinary attachments and env templates", () => {
    for (const p of [
      "/home/u/proj/src/index.ts",
      "/home/u/proj/README.md",
      "/home/u/proj/.env.example",
      "/home/u/screenshot.png",
      "/home/u/report.pdf",
    ])
      expect(blocked(p)).toBe(false)
  })
})

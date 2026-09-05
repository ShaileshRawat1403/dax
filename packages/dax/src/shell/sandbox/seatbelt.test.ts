import { expect, test } from "bun:test"
import { SeatbeltSandbox } from "./seatbelt"

test("non-strict seatbelt keeps default denial before its explicit grants", async () => {
  const wrapped = await new SeatbeltSandbox(false).wrap("echo ok", "/tmp")
  expect(wrapped).toContain("(deny default)")
  expect(wrapped).not.toContain("(allow default)")
  expect(wrapped.indexOf("(deny default)")).toBeLessThan(wrapped.indexOf("(allow file-read*"))
})

test.skipIf(process.platform !== "darwin")("non-strict seatbelt denies an unlisted executable", async () => {
  // Exercise the actual profile directly; argv wrapper migration belongs to WO-6.
  const wrapped = await new SeatbeltSandbox(false).wrap("echo ok", "/tmp")
  const profile = wrapped.match(/-p '([\s\S]+)' \/tmp /)?.[1]
  expect(profile).toBeDefined()
  const allowed = Bun.spawn(["/usr/bin/sandbox-exec", "-p", profile!, "/bin/sh", "-c", "echo allowed"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(await new Response(allowed.stderr).text()).toBe("")
  expect(await new Response(allowed.stdout).text()).toBe("allowed\n")
  expect(await allowed.exited).toBe(0)
  const proc = Bun.spawn(["/usr/bin/sandbox-exec", "-p", profile!, "/usr/bin/true"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const error = await new Response(proc.stderr).text()
  expect(await proc.exited).not.toBe(0)
  expect(error).toContain("Operation not permitted")
  expect(error).not.toContain("sandbox_apply")
})

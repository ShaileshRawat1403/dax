import { expect, test } from "bun:test"
import { SeatbeltSandbox } from "./seatbelt"

function profileOf(argv: string[]): string {
  const index = argv.indexOf("-p")
  expect(index).toBeGreaterThanOrEqual(0)
  return argv[index + 1]!
}

test("non-strict seatbelt keeps default denial before its explicit grants", async () => {
  const profile = profileOf(await new SeatbeltSandbox(false).wrap("echo ok", "/tmp"))
  expect(profile).toContain("(deny default)")
  expect(profile).not.toContain("(allow default)")
  expect(profile.indexOf("(deny default)")).toBeLessThan(profile.indexOf("(allow file-read*"))
})

test("the wrapper is argv, and the command is a single element", async () => {
  const command = `echo \\" ; id # $(whoami)`
  const argv = await new SeatbeltSandbox(true).wrap(command, "/tmp")
  expect(argv[0]).toBe("sandbox-exec")
  expect(argv.slice(-3)).toEqual(["/bin/sh", "-c", command])
  // The working directory is applied by the spawn, not passed as an argument.
  expect(argv).not.toContain("/tmp")
})

test.skipIf(process.platform !== "darwin")("non-strict seatbelt denies an unlisted executable", async () => {
  const profile = profileOf(await new SeatbeltSandbox(false).wrap("echo ok", "/tmp"))
  const allowed = Bun.spawn(["/usr/bin/sandbox-exec", "-p", profile, "/bin/sh", "-c", "echo allowed"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(await new Response(allowed.stderr).text()).toBe("")
  expect(await new Response(allowed.stdout).text()).toBe("allowed\n")
  expect(await allowed.exited).toBe(0)
  const proc = Bun.spawn(["/usr/bin/sandbox-exec", "-p", profile, "/usr/bin/true"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const error = await new Response(proc.stderr).text()
  expect(await proc.exited).not.toBe(0)
  expect(error).toContain("Operation not permitted")
  expect(error).not.toContain("sandbox_apply")
})

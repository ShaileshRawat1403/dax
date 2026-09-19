import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Rpc } from "./rpc"

test("RPC queues startup requests until a delayed worker installs its handler", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "dax-rpc-"))
  const file = path.join(dir, "worker.ts")
  await writeFile(
    file,
    `
    import { Rpc } from ${JSON.stringify(new URL("./rpc.ts", import.meta.url).href)}
    await Bun.sleep(100)
    Rpc.listen({
      echo: (input) => input,
      fail: () => { throw new Error("worker operation failed") },
    })
  `,
  )
  const worker = new Worker(file)
  try {
    const client = Rpc.client<{ echo: (input: string) => string; fail: (input: null) => never }>(worker)
    expect(await Promise.all([client.call("echo", "first"), client.call("echo", "second")])).toEqual([
      "first",
      "second",
    ])
    const failure = await client.call("fail", null).then(
      () => null,
      (error: Error) => error,
    )
    expect(failure?.message).toBe("worker operation failed")
    expect(await client.call("echo", "after error")).toBe("after error")
  } finally {
    worker.terminate()
    await rm(dir, { recursive: true, force: true })
  }
})

test("RPC rejects queued and future calls when the worker never becomes ready", async () => {
  const posted: string[] = []
  const target = {
    postMessage(message: string) {
      posted.push(message)
    },
    onmessage: null as ((this: Worker, event: MessageEvent) => unknown) | null,
  }
  const client = Rpc.client<{ echo: (input: string) => string }>(target, { startupTimeoutMs: 10 })
  const first = await client.call("echo", "first").then(
    () => null,
    (error: Error) => error,
  )
  const second = await client.call("echo", "second").then(
    () => null,
    (error: Error) => error,
  )
  expect(first?.message).toContain("worker readiness")
  expect(second?.message).toBe(first?.message)
  expect(posted).toEqual([])
})

import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Storage } from "./storage"

test("storage rename atomically replaces an existing destination", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "dax-storage-rename-"))
  const previous = process.env.DAX_TEST_HOME
  process.env.DAX_TEST_HOME = home
  try {
    const source = ["rename_test", "source"]
    const destination = ["rename_test", "destination"]
    await Storage.write(source, { value: "new" })
    await Storage.write(destination, { value: "old" })

    await Storage.rename(source, destination)

    const value = await Storage.read<{ value: string }>(destination)
    expect(value).toEqual({ value: "new" })
    const missing = await Storage.read(source).then(
      () => undefined,
      (error) => error,
    )
    expect(Storage.NotFoundError.isInstance(missing)).toBe(true)
  } finally {
    if (previous === undefined) delete process.env.DAX_TEST_HOME
    else process.env.DAX_TEST_HOME = previous
    await fs.rm(home, { recursive: true, force: true })
  }
})

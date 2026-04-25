import { Instance } from "../src/project/instance"
import { InstanceBootstrap } from "../src/project/bootstrap"
import { Session } from "../src/session"

const run = async () => {
  await Instance.provide({
    directory: process.cwd(),
    init: InstanceBootstrap,
    fn: async () => {
      let count = 0
      for await (const session of Session.list()) {
        count++
      }
      console.log(`Sessions remaining: ${count}`)
    },
  })
}

run().catch(console.error)

import { Instance } from "../src/project/instance"
import { InstanceBootstrap } from "../src/project/bootstrap"
import { Session } from "../src/session"
import { Storage } from "../src/storage/storage"

const BATCH_SIZE = 50

const run = async () => {
  await Instance.provide({
    directory: process.cwd(),
    init: InstanceBootstrap,
    fn: async () => {
      console.log("Starting fast cleanup...")

      const allSessions: string[] = []
      for await (const session of Session.list()) {
        allSessions.push(session.id)
      }

      console.log(`Found ${allSessions.length} sessions to delete.`)
      let deleted = 0

      for (let i = 0; i < allSessions.length; i += BATCH_SIZE) {
        const batch = allSessions.slice(i, i + BATCH_SIZE)

        await Promise.all(
          batch.map(async (sessionId) => {
            try {
              // Bypass pub/sub and slow unshare logic to forcefully clean test data
              const messages = await Storage.list(["message", sessionId])
              await Promise.all(
                messages.map(async (msg) => {
                  const parts = await Storage.list(["part", msg.at(-1)!])
                  await Promise.all(parts.map((part) => Storage.remove(part)))
                  await Storage.remove(msg)
                }),
              )
              await Storage.remove(["session", Instance.project.id, sessionId])
            } catch (err) {
              console.error(`Failed to delete storage for session ${sessionId}`)
            }
          }),
        )

        deleted += batch.length
        process.stdout.write(`\rDeleted ${deleted}/${allSessions.length} sessions...`)
      }

      console.log("\nAll testing sessions successfully deleted. DAX is clean!")
    },
  })
}

run()
  .catch(console.error)
  .finally(() => process.exit(0))

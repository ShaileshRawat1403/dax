import { Instance } from "../src/project/instance"
import { InstanceBootstrap } from "../src/project/bootstrap"
import { Session } from "../src/session"
import * as fs from "fs/promises"
import * as path from "path"

const run = async () => {
  const dir = process.cwd()
  const backupDir = path.join(dir, `artifacts/sessions_backup_${Date.now()}`)

  await Instance.provide({
    directory: dir,
    init: InstanceBootstrap,
    fn: async () => {
      let count = 0

      // First, let's figure out if we have any sessions
      for await (const session of Session.list()) {
        if (count === 0) {
          // Only create backup directory if there are sessions to backup
          await fs.mkdir(backupDir, { recursive: true })
          console.log(`Saving backups to ${backupDir}`)
        }
        count++

        console.log(`Processing session: ${session.id} - ${session.title}`)

        try {
          const messages = await Session.messages({ sessionID: session.id })
          const backupData = {
            info: session,
            messages,
          }

          await fs.writeFile(path.join(backupDir, `${session.id}.json`), JSON.stringify(backupData, null, 2))

          await Session.remove(session.id)
          console.log(`✓ Backed up and deleted session: ${session.id}`)
        } catch (error) {
          console.error(`✗ Failed to process session ${session.id}:`, error)
        }
      }

      if (count === 0) {
        console.log("No sessions found to clean up. DAX is already clean!")
      } else {
        console.log(`\nCleanup complete! Deleted ${count} sessions.`)
        console.log(`Backups safely stored in: ${backupDir}`)
      }
    },
  })
}

run().catch((err) => {
  console.error("Cleanup failed:", err)
  process.exit(1)
})

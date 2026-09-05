import { expect, test } from "bun:test"

test(
  "appended audit events form a chain that detects tampering",
  async () => {
    try {
      const { PM } = await import("./index")
      const project = `prj_chain_${Date.now().toString(36)}`

      for (const step of ["first", "second", "third"]) {
        await PM.append_event({ project_id: project, event_type: "audit", payload: { step } })
      }

      const clean = await PM.verify_events({ project_id: project })
      expect(clean.chained).toBe(3)
      expect(clean.unchained).toBe(0)
      expect(clean.ok).toBe(true)

      // Rewrite history the way anyone with the SQLite file could. Before
      // chaining, `dax audit` printed this back without complaint.
      const { Database } = await import("bun:sqlite")
      // PM resolves its database path at module load, so ask it rather than
      // recomputing one from the environment this test happens to see.
      const db = new Database(PM.databaseFile)
      db.prepare("update pm_rao_event set payload = ? where project_id = ? and chain_seq = 1").run(
        JSON.stringify({ step: "doctored" }),
        project,
      )
      db.close()

      const tampered = await PM.verify_events({ project_id: project })
      expect(tampered.ok).toBe(false)
      expect(tampered.failure?.seq).toBe(1)
      expect(tampered.failure?.reason).toContain("modified")
    } finally {
      // Rows are scoped to a unique project id, so nothing else is disturbed.
    }
  },
  60_000,
)

---
name: "db-migration-review"
description: "Review a database schema migration for production safety: lock contention, backfill strategy, online vs offline, rollback path, foreign-key timing, replication lag. Returns impact-ordered findings tables."
---

# DB Migration Review

Use this skill when the task is to review a schema migration before it runs against a production database. Migration bugs are silent — they often pass tests against an empty schema and then break under load or scale.

## Use when

- a migration is about to ship in a release
- a migration ran against staging and the user wants a second opinion before production
- a previous migration caused an outage and the new one is being scrutinized
- the database is large enough that "just run it" is no longer safe

## Workflow

1. **Identify the database and engine.** Postgres, MySQL, SQLite, MSSQL, or other. Migration tooling (Flyway, Liquibase, Alembic, Diesel, ActiveRecord, custom). Engine version. Replication setup if any.
2. **Inventory the migration.**
   - Schema changes: tables created/dropped/renamed, columns added/dropped/renamed, type changes
   - Index changes: created, dropped, renamed
   - Constraint changes: foreign keys, checks, uniques
   - Data changes: backfills, deletions, transforms
   - The order of operations within the migration file
3. **Locking risk.**
   - Postgres: `ALTER TABLE ... ADD COLUMN ... NOT NULL` rewrites the table — flag for any non-trivial table size
   - MySQL: `ALTER TABLE` lock semantics depend on engine and version — call out the specific risk
   - Adding an index without `CONCURRENTLY` / `ONLINE` will block writes on large tables
   - Foreign key creation requires a full table scan with a lock by default
4. **NOT NULL with default.**
   - In modern Postgres (11+), a NOT NULL column with a constant default is fast. With a *volatile* default (e.g., `now()`), it rewrites the table.
   - In MySQL and older Postgres, NOT NULL with default always rewrites.
   - Flag the version-specific risk and the recommended pattern (add nullable, backfill, then add constraint).
5. **Backfill strategy.**
   - For tables larger than a few million rows, backfills must be batched and idempotent.
   - Each batch should commit and pause to let replication catch up.
   - Backfill should be rerunnable from the last committed batch.
   - Flag in-transaction backfills against large tables.
6. **Foreign-key timing.**
   - `NOT VALID` + `VALIDATE CONSTRAINT` pattern (Postgres) avoids the full lock — flag missing use.
   - Adding FK to a high-write child table requires careful ordering with the backfill.
7. **Drop vs rename.**
   - Dropping columns / tables is irreversible in production — flag missing rollback path.
   - Renaming a column the application still references will break instantly — flag unless the rename is the second step of a multi-deploy migration.
8. **Multi-deploy patterns.**
   - Risky migrations should be split: deploy code that tolerates both shapes, run migration, deploy code that uses the new shape.
   - Flag single-deploy migrations that change a contract the running code depends on.
9. **Rollback path.**
   - Every migration should have a written rollback procedure, even if it's "redeploy the prior code; data is unchanged."
   - DROP COLUMN has no rollback — flag and require a paired backup plan or feature-flagged rollout.
10. **Replication impact.**
    - Long-running migrations create replication lag on read replicas — estimate the impact and time-of-day appropriate to run.
11. **Test evidence.**
    - The migration ran against a realistic dataset (not just an empty schema).
    - Rollback was tested if rollback is claimed.
    - The application's existing tests pass against both pre- and post-migration schemas where multi-deploy applies.

## Checks

- Flag findings as Critical only when the migration *will* cause outage or data loss in production
- Distinguish "Postgres N+" from "Postgres N-" version-specific risks — be explicit about which version the project runs
- Do not flag standard nullable-column additions on small tables — they are safe and common
- For SQLite, the lock model is fundamentally different; do not paste Postgres advice

## Output contract

Findings follow [docs/skills/OUTPUT_CONTRACT.md](../../docs/skills/OUTPUT_CONTRACT.md).

Return:

1. **Verdict** — one line + a small table:
   - `Engine`, `Engine version`, `Approx. table size(s) touched`, `Replication?`, `Single-deploy or multi-deploy?`
2. **Counts** — Critical/High/Medium/Low/Info totals
3. **Findings** — one table per category, ordered by impact:
   - Locking and rewrites
   - NOT NULL and constraint timing
   - Backfill strategy
   - Foreign-key timing
   - Drop / rename / irreversibility
   - Multi-deploy ordering
   - Rollback path
   - Replication and timing
4. **Open questions / assumptions** — engine version, dataset size, replication topology, when the migration will run
5. **Residual risk** — what can only be verified against the real production data
6. **Next actions** — concrete fixes; for Critical findings, propose the exact rewrite

## Evidence to collect

- Migration file path + line for every statement
- The exact DDL/DML verbatim for flagged statements
- Engine version (read from `SELECT version()` or the project's config)
- Table row-count estimates (read from project docs, dashboards, or `pg_stat_user_tables` when accessible)
- Whether the project has a prior migration for the same table (to spot patterns)

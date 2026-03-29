import { connect, RetentionPolicy, StorageType, type NatsConnection } from "nats"
import { credsAuthenticator } from "nats/lib/nats-base-client/authenticator"
import { headers } from "nats/lib/nats-base-client/headers"
import { consumerOpts } from "nats/lib/jetstream/types"
import type { JetStreamClient, JetStreamManager, JetStreamSubscription } from "nats/lib/jetstream/types"
import type { RunEvent } from "../run-contract"
import { Flag } from "@/flag/flag"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "nats-transport" })

const NATS_SUBJECTS = {
  runLifecycle: "dax.runs.lifecycle",
  runEvents: (runId: string) => `dax.runs.${runId}.events`,
  approvals: (runId: string) => `dax.approvals.${runId}`,
  recovery: (runId: string) => `dax.recovery.${runId}`,
} as const

export type RunEventCategory = "lifecycle" | "step" | "approval" | "trust" | "artifact" | "recovery"

function categorizeEvent(event: RunEvent): RunEventCategory {
  const type = event.type
  if (type.startsWith("run.")) return "lifecycle"
  if (type.startsWith("step.")) return "step"
  if (type.startsWith("approval.")) return "approval"
  if ((type as any) === "trust.updated") return "trust"
  if (type === "artifact.created") return "artifact"
  return "recovery"
}

function buildNatsSubject(event: RunEvent): string {
  const category = categorizeEvent(event)
  switch (category) {
    case "lifecycle":
    case "step":
    case "trust":
    case "artifact":
      return NATS_SUBJECTS.runEvents(event.runId)
    case "approval":
      return NATS_SUBJECTS.approvals(event.runId)
    case "recovery":
      return NATS_SUBJECTS.recovery(event.runId)
  }
}

export class NatsTransport {
  private nc: NatsConnection | null = null
  private js: JetStreamClient | null = null
  private jsm: JetStreamManager | null = null
  private initialized = false
  private initPromise: Promise<void> | null = null
  private subscriptions: JetStreamSubscription[] = []

  async initialize(opts?: { credsData?: Uint8Array }): Promise<void> {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise

    if (!Flag.DAX_NATS_ENABLED) {
      log.info("NATS transport disabled - set DAX_NATS_ENABLED=true to enable")
      this.initialized = true
      return
    }

    this.initPromise = this._connect(opts?.credsData)
    return this.initPromise
  }

  private async _connect(credsData?: Uint8Array): Promise<void> {
    try {
      const servers = Flag.DAX_NATS_URL
      log.info("connecting to NATS", { servers })

      const connectOpts: Record<string, unknown> = {
        servers: [Flag.DAX_NATS_URL],
        name: `dax-${Instance.project.id ?? "local"}`,
        maxReconnectAttempts: 10,
        reconnectTimeWait: 1000,
      }

      if (credsData) {
        connectOpts.authenticator = credsAuthenticator(credsData)
      } else if (Flag.DAX_NATS_CREDS) {
        try {
          const data = await Bun.file(Flag.DAX_NATS_CREDS).arrayBuffer()
          const credsBytes = new Uint8Array(data)
          connectOpts.authenticator = credsAuthenticator(credsBytes)
        } catch {
          log.warn("failed to load NATS creds file, skipping auth", { file: Flag.DAX_NATS_CREDS })
        }
      }

      this.nc = await connect(connectOpts as Parameters<typeof connect>[0])

      this.js = this.nc.jetstream({})

      this.nc.closed().then((err: Error | void) => {
        if (err) {
          log.error("NATS connection closed with error", { error: String(err) })
        } else {
          log.info("NATS connection closed")
        }
      })

      await this.ensureStream()
      this.initialized = true
      log.info("NATS transport initialized", { stream: Flag.DAX_NATS_STREAM })
    } catch (error) {
      log.warn("failed to connect to NATS - transport disabled", {
        error: error instanceof Error ? error.message : String(error),
      })
      this.nc = null
      this.js = null
      this.initialized = true
    }
  }

  private async ensureStream(): Promise<void> {
    if (!this.nc) return
    try {
      this.jsm = await this.nc.jetstreamManager()
      const streamName = Flag.DAX_NATS_STREAM
      const subjects = [NATS_SUBJECTS.runLifecycle, "dax.runs.>", "dax.approvals.>", "dax.recovery.>"]

      try {
        await this.jsm.streams.info(streamName)
        log.info("NATS stream exists", { stream: streamName })
      } catch {
        log.info("creating NATS stream", { stream: streamName })
        await this.jsm.streams.add({
          name: streamName,
          subjects,
          retention: RetentionPolicy.Limits,
          max_bytes: 1_073_741_824,
          max_age: 7 * 24 * 60 * 60 * 1_000_000_000,
          storage: StorageType.File,
        })
        log.info("NATS stream created", { stream: streamName })
      }
    } catch (error) {
      log.warn("failed to ensure NATS stream", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async publish(event: RunEvent): Promise<void> {
    if (!Flag.DAX_NATS_ENABLED) return
    if (!this.js) {
      await this.initialize()
    }
    if (!this.js || !this.nc || this.nc.isClosed()) return

    const subject = buildNatsSubject(event)
    const lifecycleSubject = event.type.startsWith("run.") ? NATS_SUBJECTS.runLifecycle : subject

    const data = JSON.stringify(event)
    const hdrs = headers()
    hdrs.set("dax-run-id", event.runId)
    hdrs.set("dax-event-type", event.type)
    hdrs.set("dax-project-id", Instance.project.id ?? "unknown")
    hdrs.set("dax-instance", Instance.directory)

    try {
      await this.js.publish(subject, data, { headers: hdrs })
      if (lifecycleSubject !== subject) {
        await this.js.publish(lifecycleSubject, data, { headers: hdrs })
      }
      log.debug("published event to NATS", { subject, eventType: event.type, eventId: event.eventId })
    } catch (error) {
      log.warn("failed to publish event to NATS", {
        error: error instanceof Error ? error.message : String(error),
        subject,
        eventType: event.type,
      })
    }
  }

  async subscribe(subject: string, callback: (event: RunEvent) => void | Promise<void>): Promise<() => void> {
    if (!this.js) {
      await this.initialize()
    }
    if (!this.js || !this.nc || this.nc.isClosed()) {
      return () => {}
    }

    try {
      const opts = consumerOpts()
      opts.callback((err: unknown, msg: unknown) => {
        if (err || !msg) {
          log.warn("NATS subscription error", { subject, error: String(err) })
          return
        }
        const jsMsg = msg as { data: Uint8Array; headers: unknown }
        try {
          const event = JSON.parse(new TextDecoder().decode(jsMsg.data)) as RunEvent
          callback(event)
        } catch (parseError) {
          log.warn("failed to parse NATS message", {
            subject,
            error: parseError instanceof Error ? parseError.message : String(parseError),
          })
        }
      })

      const sub = await this.js.subscribe(subject, opts)
      this.subscriptions.push(sub)
      log.info("NATS subscription created", { subject })
      return () => {
        sub.unsubscribe()
        log.info("NATS subscription closed", { subject })
      }
    } catch (error) {
      log.warn("failed to subscribe to NATS subject", {
        subject,
        error: error instanceof Error ? error.message : String(error),
      })
      return () => {}
    }
  }

  async close(): Promise<void> {
    for (const sub of this.subscriptions) {
      try {
        sub.unsubscribe()
      } catch {
        // ignore unsubscribe errors during cleanup
      }
    }
    this.subscriptions = []
    if (this.nc) {
      await this.nc.close()
      this.nc = null
      this.js = null
      this.jsm = null
      this.initialized = false
      log.info("NATS transport closed")
    }
  }

  get isConnected(): boolean {
    return this.nc != null && !this.nc.isClosed()
  }
}

export const natsTransport = new NatsTransport()

export { NATS_SUBJECTS }

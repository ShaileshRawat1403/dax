import { Log } from "@/util/log"

const log = Log.create({ service: "dax-telemetry" })

export type SpanStatus = "ok" | "error"

export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined
}

export interface Span {
  end(status?: SpanStatus, attributes?: SpanAttributes): void
  recordException(error: Error, attributes?: SpanAttributes): void
  setAttributes(attributes: SpanAttributes): void
}

export interface TraceContext {
  traceId?: string
  spanId?: string
}

export interface TelemetryConfig {
  serviceName: string
  enabled?: boolean
  exporter?: TelemetryExporter
}

export interface TelemetryExporter {
  exportSpan(span: ExportedSpan): void
}

export interface ExportedSpan {
  name: string
  traceId: string
  spanId: string
  parentSpanId?: string
  startTime: number
  endTime: number
  status: SpanStatus
  attributes: SpanAttributes
  events: SpanEvent[]
}

export interface SpanEvent {
  name: string
  timestamp: number
  attributes?: SpanAttributes
}

const SPAN_EVENTS_LIMIT = 128

let config: TelemetryConfig | null = null
let traceIdCounter = 0
let spanIdCounter = 0

function generateTraceId(): string {
  return `00000000000000000000000000000000${(++traceIdCounter).toString(16)}`.slice(-32)
}

function generateSpanId(): string {
  return `0000000000000000${(++spanIdCounter).toString(16)}`.slice(-16)
}

export namespace Telemetry {
  export function initialize(cfg: TelemetryConfig): void {
    config = cfg
    if (cfg.enabled) {
      log.info("telemetry initialized", { serviceName: cfg.serviceName })
    }
  }

  export function isEnabled(): boolean {
    return config?.enabled ?? false
  }

  export function getServiceName(): string {
    return config?.serviceName ?? "dax"
  }

  export function startSpan(name: string, parentContext?: TraceContext, attributes?: SpanAttributes): Span {
    const traceId = parentContext?.traceId ?? generateTraceId()
    const spanId = generateSpanId()
    const parentSpanId = parentContext?.spanId
    const startTime = Date.now()
    const events: SpanEvent[] = []
    let ended = false
    let status: SpanStatus = "ok"
    let spanAttributes = { ...attributes }

    function end(finalStatus?: SpanStatus, finalAttributes?: SpanAttributes): void {
      if (ended) return
      ended = true
      status = finalStatus ?? status
      spanAttributes = { ...spanAttributes, ...finalAttributes }

      const exportedSpan: ExportedSpan = {
        name,
        traceId,
        spanId,
        parentSpanId,
        startTime,
        endTime: Date.now(),
        status,
        attributes: spanAttributes,
        events: events.slice(0, SPAN_EVENTS_LIMIT),
      }

      if (config?.exporter) {
        config.exporter.exportSpan(exportedSpan)
      }

      log.debug("span completed", {
        name,
        traceId,
        spanId,
        status,
        durationMs: exportedSpan.endTime - startTime,
      })
    }

    return {
      end,
      recordException(error: Error, attrs?: SpanAttributes): void {
        events.push({
          name: "exception",
          timestamp: Date.now(),
          attributes: {
            "exception.type": error.name ?? "Error",
            "exception.message": error.message,
            "exception.stacktrace": error.stack,
            ...attrs,
          },
        })
        end("error", attrs)
      },
      setAttributes(attrs: SpanAttributes): void {
        spanAttributes = { ...spanAttributes, ...attrs }
      },
    }
  }

  export function createContext(traceId?: string, spanId?: string): TraceContext {
    return {
      traceId: traceId ?? generateTraceId(),
      spanId: spanId ?? generateSpanId(),
    }
  }

  export function withSpan<T>(
    name: string,
    fn: (span: Span) => T,
    parentContext?: TraceContext,
    attributes?: SpanAttributes,
  ): T {
    const span = startSpan(name, parentContext, attributes)
    try {
      const result = fn(span)
      if (result instanceof Promise) {
        return result
          .then((value) => {
            span.end("ok")
            return value
          })
          .catch((error) => {
            span.recordException(error instanceof Error ? error : new Error(String(error)))
            throw error
          }) as T
      }
      span.end("ok")
      return result
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }

  export async function withSpanAsync<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    parentContext?: TraceContext,
    attributes?: SpanAttributes,
  ): Promise<T> {
    const span = startSpan(name, parentContext, attributes)
    try {
      const result = await fn(span)
      span.end("ok")
      return result
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }
}

export const Tracer = {
  runCreated(runId: string, workflowClass: string, executionMode: string): void {
    if (!Telemetry.isEnabled()) return
    Telemetry.startSpan("run.created", undefined, {
      "run.id": runId,
      "run.workflow_class": workflowClass,
      "run.execution_mode": executionMode,
    }).end("ok")
  },

  contractCompiled(runId: string, contractId: string, riskLevel: string): void {
    if (!Telemetry.isEnabled()) return
    Telemetry.startSpan("contract.compiled", undefined, {
      "run.id": runId,
      "contract.id": contractId,
      "contract.risk_level": riskLevel,
    }).end("ok")
  },

  stateTransition(runId: string, fromStatus: string, toStatus: string): void {
    if (!Telemetry.isEnabled()) return
    Telemetry.startSpan("state.transition", undefined, {
      "run.id": runId,
      "state.from": fromStatus,
      "state.to": toStatus,
    }).end("ok")
  },

  approvalRequested(runId: string, approvalId: string, approvalType: string, risk: string): void {
    if (!Telemetry.isEnabled()) return
    Telemetry.startSpan("approval.requested", undefined, {
      "run.id": runId,
      "approval.id": approvalId,
      "approval.type": approvalType,
      "approval.risk": risk,
    }).end("ok")
  },

  approvalResolved(runId: string, approvalId: string, decision: string): void {
    if (!Telemetry.isEnabled()) return
    Telemetry.startSpan("approval.resolved", undefined, {
      "run.id": runId,
      "approval.id": approvalId,
      "approval.decision": decision,
    }).end("ok")
  },

  workflowStep(runId: string, stepId: string, stepName: string, status: string): void {
    if (!Telemetry.isEnabled()) return
    Telemetry.startSpan("workflow.step", undefined, {
      "run.id": runId,
      "step.id": stepId,
      "step.name": stepName,
      "step.status": status,
    }).end("ok")
  },

  workflowCompleted(runId: string, workflowClass: string, durationMs: number, outcome: string): void {
    if (!Telemetry.isEnabled()) return
    Telemetry.startSpan("workflow.completed", undefined, {
      "run.id": runId,
      "workflow.class": workflowClass,
      "workflow.duration_ms": durationMs,
      "workflow.outcome": outcome,
    }).end("ok")
  },

  workflowStarted(runId: string, workflowClass: string): void {
    if (!Telemetry.isEnabled()) return
    Telemetry.startSpan("workflow.started", undefined, {
      "run.id": runId,
      "workflow.class": workflowClass,
    }).end("ok")
  },

  workflowFailed(runId: string, workflowClass: string, error: string, reason: string): void {
    if (!Telemetry.isEnabled()) return
    Telemetry.startSpan("workflow.failed", undefined, {
      "run.id": runId,
      "workflow.class": workflowClass,
      "workflow.error": error,
      "workflow.failure_reason": reason,
    }).end("error")
  },

  approvalWaitTime(runId: string, workflowClass: string, waitTimeMs: number, decision: string): void {
    if (!Telemetry.isEnabled()) return
    Telemetry.startSpan("approval.wait_time", undefined, {
      "run.id": runId,
      "workflow.class": workflowClass,
      "approval.wait_time_ms": waitTimeMs,
      "approval.decision": decision,
    }).end("ok")
  },

  legacyFallback(runId: string, reason: string): void {
    if (!Telemetry.isEnabled()) return
    Telemetry.startSpan("legacy.fallback", undefined, {
      "run.id": runId,
      "fallback.reason": reason,
      authority: "dax-legacy",
    }).end("ok")
  },

  authorityCounters(daxStateMachine: number, daxLegacy: number): void {
    if (!Telemetry.isEnabled()) return
    Telemetry.startSpan("authority.counters", undefined, {
      "authority.dax_state_machine": daxStateMachine,
      "authority.dax_legacy": daxLegacy,
    }).end("ok")
  },
}

export namespace Telemetry {
  export const Spans = {
    RUN_CREATED: "run.created",
    CONTRACT_COMPILED: "contract.compiled",
    STATE_TRANSITION: "state.transition",
    APPROVAL_REQUESTED: "approval.requested",
    APPROVAL_RESOLVED: "approval.resolved",
    APPROVAL_WAIT_TIME: "approval.wait_time",
    WORKFLOW_STARTED: "workflow.started",
    WORKFLOW_STEP: "workflow.step",
    WORKFLOW_COMPLETED: "workflow.completed",
    WORKFLOW_FAILED: "workflow.failed",
    LEGACY_FALLBACK: "legacy.fallback",
    AUTHORITY_COUNTERS: "authority.counters",
  } as const

  export const Attributes = {
    RUN_ID: "run.id",
    CONTRACT_ID: "contract.id",
    WORKFLOW_CLASS: "run.workflow_class",
    EXECUTION_MODE: "run.execution_mode",
    RISK_LEVEL: "contract.risk_level",
    STATE_FROM: "state.from",
    STATE_TO: "state.to",
    APPROVAL_ID: "approval.id",
    APPROVAL_TYPE: "approval.type",
    APPROVAL_RISK: "approval.risk",
    APPROVAL_DECISION: "approval.decision",
    APPROVAL_WAIT_TIME_MS: "approval.wait_time_ms",
    STEP_ID: "step.id",
    STEP_NAME: "step.name",
    STEP_STATUS: "step.status",
    DURATION_MS: "workflow.duration_ms",
    OUTCOME: "workflow.outcome",
    WORKFLOW_ERROR: "workflow.error",
    WORKFLOW_FAILURE_REASON: "workflow.failure_reason",
    AUTHORITY: "authority",
    AUTHORITY_DAX_STATE_MACHINE: "authority.dax_state_machine",
    AUTHORITY_DAX_LEGACY: "authority.dax_legacy",
    FALLBACK_REASON: "fallback.reason",
  } as const
}

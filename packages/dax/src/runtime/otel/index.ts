import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http"
import { resourceFromAttributes } from "@opentelemetry/resources"
import type { Resource } from "@opentelemetry/resources"
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions"
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base"
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics"
import { Flag } from "@/flag/flag"
import { Installation } from "@/installation"
import { Log } from "@/util/log"
import { Telemetry } from "@/runtime/telemetry"
import type { TelemetryExporter, ExportedSpan, SpanAttributes } from "@/runtime/telemetry"

const log = Log.create({ service: "otel" })

let traceExporter: OTLPTraceExporter | null = null
let traceProvider: BasicTracerProvider | null = null
let metricExporter: OTLPMetricExporter | null = null
let meterProvider: MeterProvider | null = null

function buildResource(): Resource {
  const serviceName = Flag.OTEL_SERVICE_NAME ?? "dax"
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: Installation.VERSION,
    "deployment.environment": Flag.INFISICAL_ENVIRONMENT ?? "dev",
  })
}

function buildTraceEndpoint(): string {
  if (Flag.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
    return Flag.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
  }
  const base = Flag.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, "")
  return `${base}/v1/traces`
}

function buildMetricsEndpoint(): string {
  if (Flag.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT) {
    return Flag.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
  }
  const base = Flag.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, "")
  return `${base}/v1/metrics`
}

export function initialize(): void {
  if (!Flag.OTEL_ENABLED) {
    log.info("OTel disabled - set OTEL_ENABLED=true to enable")
    return
  }

  const resource = buildResource()

  try {
    const traceEndpoint = buildTraceEndpoint()
    traceExporter = new OTLPTraceExporter({ url: traceEndpoint })

    traceProvider = new BasicTracerProvider({
      resource,
      spanProcessors: [new SimpleSpanProcessor(traceExporter)],
    })

    log.info("OTel trace initialized", {
      serviceName: Flag.OTEL_SERVICE_NAME,
      endpoint: traceEndpoint,
    })
  } catch (error) {
    log.warn("failed to initialize OTel trace exporter", {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    const metricsEndpoint = buildMetricsEndpoint()
    metricExporter = new OTLPMetricExporter({ url: metricsEndpoint })

    meterProvider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: metricExporter,
          exportIntervalMillis: 30_000,
        }),
      ],
    })

    log.info("OTel metrics initialized", { endpoint: metricsEndpoint })
  } catch (error) {
    log.warn("failed to initialize OTel metrics exporter", {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  Telemetry.initialize({
    serviceName: Flag.OTEL_SERVICE_NAME ?? "dax",
    enabled: true,
    exporter: createOtelExporter(),
  })
}

function createOtelExporter(): TelemetryExporter {
  return {
    exportSpan(span: ExportedSpan): void {
      if (!traceExporter) return
      try {
        const otelSpan = {
          name: span.name,
          traceId: span.traceId,
          spanId: span.spanId,
          parentSpanId: span.parentSpanId,
          startTime: BigInt(span.startTime * 1_000_000),
          endTime: BigInt(span.endTime * 1_000_000),
          status: span.status === "error" ? "error" : "ok",
          attributes: flattenAttributes(span.attributes),
          events: span.events.map((e) => ({
            name: e.name,
            timestamp: BigInt(e.timestamp * 1_000_000),
            attributes: flattenAttributes(e.attributes ?? {}),
          })),
        }
        traceExporter.export([otelSpan as any], (result) => {
          if (result.error) {
            log.debug("OTel span export failed", { error: String(result.error) })
          }
        })
      } catch (error) {
        log.debug("failed to export span to OTel", {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }
}

function flattenAttributes(attrs: SpanAttributes): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) {
      result[key] = value
    }
  }
  return result
}

export function createMeter(name: string) {
  if (!meterProvider) return null
  return meterProvider.getMeter(name)
}

export function shutdown(): void {
  if (traceProvider) {
    traceProvider.shutdown().catch(() => {})
  }
  if (meterProvider) {
    meterProvider.shutdown().catch(() => {})
  }
  log.info("OTel shutdown complete")
}

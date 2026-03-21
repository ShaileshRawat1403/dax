import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "migration-report" })

export interface AuthorityDistribution {
  dax_state_machine: number
  dax_legacy: number
  dax_mixed: number
  total: number
  percentage: {
    dax_state_machine: number
    dax_legacy: number
  }
}

export interface FallbackEvent {
  timestamp: string
  runId: string
  reason: string
}

export interface MigrationReport {
  generatedAt: string
  authority: AuthorityDistribution
  fallbackEvents: FallbackEvent[]
  recommendations: string[]
}

const fallbackEvents: FallbackEvent[] = []

export namespace MigrationReport {
  export function recordFallback(runId: string, reason: string): void {
    fallbackEvents.push({
      timestamp: new Date().toISOString(),
      runId,
      reason,
    })
    if (fallbackEvents.length > 1000) {
      fallbackEvents.shift()
    }
  }

  export function getAuthorityDistribution(counters: ReturnType<typeof getAuthorityCounters>): AuthorityDistribution {
    const total = counters.dax_state_machine + counters.dax_legacy + counters.dax_mixed
    return {
      ...counters,
      percentage: {
        dax_state_machine: total > 0 ? (counters.dax_state_machine / total) * 100 : 0,
        dax_legacy: total > 0 ? (counters.dax_legacy / total) * 100 : 0,
      },
    }
  }

  export function generateReport(counters: ReturnType<typeof getAuthorityCounters>): MigrationReport {
    const distribution = getAuthorityDistribution(counters)
    const recentFallbacks = fallbackEvents.slice(-100)

    const recommendations: string[] = []

    if (distribution.percentage.dax_legacy > 0) {
      recommendations.push(
        `${distribution.percentage.dax_legacy.toFixed(1)}% of runs are using legacy path. Investigate and migrate remaining legacy paths.`,
      )
    }

    if (distribution.dax_legacy > 10) {
      recommendations.push(
        "High volume of legacy runs detected. Review integration points for proper RunState creation.",
      )
    }

    const recentFallbackReasons = recentFallbacks.reduce<Record<string, number>>((acc, event) => {
      acc[event.reason] = (acc[event.reason] || 0) + 1
      return acc
    }, {})

    const topReasons = Object.entries(recentFallbackReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reason, count]) => `${reason} (${count} occurrences)`)

    if (topReasons.length > 0) {
      recommendations.push(`Top fallback triggers: ${topReasons.join(", ")}`)
    }

    if (distribution.percentage.dax_state_machine >= 100) {
      recommendations.push("Migration complete: 100% of runs are using the deterministic execution path.")
    }

    return {
      generatedAt: new Date().toISOString(),
      authority: distribution,
      fallbackEvents: recentFallbacks,
      recommendations,
    }
  }

  export function clearHistory(): void {
    fallbackEvents.length = 0
  }
}

function getAuthorityCounters() {
  return {
    dax_state_machine: 0,
    dax_legacy: 0,
    dax_mixed: 0,
    total: 0,
  }
}

export interface MigrationMetrics {
  runs: AuthorityDistribution
  fallbacks: {
    total: number
    last24h: number
    byReason: Record<string, number>
  }
  telemetry: {
    enabled: boolean
    spansRecorded: number
  }
}

export function getMigrationMetrics(): MigrationMetrics {
  const report = MigrationReport.generateReport(getAuthorityCounters())

  const last24h = fallbackEvents.filter((event) => {
    const eventTime = new Date(event.timestamp).getTime()
    const now = Date.now()
    const dayAgo = now - 24 * 60 * 60 * 1000
    return eventTime > dayAgo
  }).length

  const byReason = fallbackEvents.reduce<Record<string, number>>((acc, event) => {
    acc[event.reason] = (acc[event.reason] || 0) + 1
    return acc
  }, {})

  return {
    runs: report.authority,
    fallbacks: {
      total: fallbackEvents.length,
      last24h,
      byReason,
    },
    telemetry: {
      enabled: false,
      spansRecorded: 0,
    },
  }
}

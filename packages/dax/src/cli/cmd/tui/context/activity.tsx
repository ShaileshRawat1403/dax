import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createSimpleContext } from "./helper"
import { cpus, freemem, totalmem } from "node:os"

export const THINKING_PUNS = [
  "Reading your codebase...",
  "Analyzing the architecture...",
  "Planning the next move...",
  "Checking for bugs...",
  "Optimizing for success...",
  "Building the solution...",
  "Verifying the changes...",
  "Preparing the response...",
  "Connecting the dots...",
  "Making it work...",
]

const cpuSnap = () =>
  cpus().reduce(
    (acc, item) => {
      const total = item.times.user + item.times.nice + item.times.sys + item.times.idle + item.times.irq
      return { idle: acc.idle + item.times.idle, total: acc.total + total }
    },
    { idle: 0, total: 0 },
  )

export const { use: useUIActivity, provider: UIActivityProvider } = createSimpleContext({
  name: "UIActivity",
  init: () => {
    const [telemetry, setTelemetry] = createSignal({ cpu: 0, ram: 0 })
    const [punIndex, setPunIndex] = createSignal(0)

    let prevCpu = cpuSnap()

    onMount(() => {
      const timer = setInterval(() => {
        // Telemetry
        const next = cpuSnap()
        const totalDiff = next.total - prevCpu.total
        const idleDiff = next.idle - prevCpu.idle
        prevCpu = next
        const cpu = totalDiff > 0 ? Math.max(0, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 100))) : 0
        const ramTotal = totalmem()
        const ramUsed = ramTotal - freemem()
        const ram = ramTotal > 0 ? Math.max(0, Math.min(100, Math.round((ramUsed / ramTotal) * 100))) : 0

        setTelemetry({ cpu, ram })

        // Puns (only update every 3 seconds, but we tick every 1s)
        // We can just use a counter or check time
      }, 1000)

      const punTimer = setInterval(() => {
        setPunIndex((prev) => (prev + 1) % THINKING_PUNS.length)
      }, 3000)

      onCleanup(() => {
        clearInterval(timer)
        clearInterval(punTimer)
      })
    })

    return {
      telemetry,
      currentPun: createMemo(() => THINKING_PUNS[punIndex()]),
    }
  },
})

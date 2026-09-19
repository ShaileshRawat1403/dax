/**
 * RPC utilities for worker/message communication.
 * Uses explicit any types because RPC endpoints accept arbitrary method names and data shapes.
 * This is a known tradeoff for flexible inter-process communication.
 */
export namespace Rpc {
  type Definition = {
    [method: string]: (input: any) => any
  }

  export function listen(rpc: Definition) {
    onmessage = async (evt) => {
      const parsed = JSON.parse(evt.data)
      if (parsed.type === "rpc.request") {
        try {
          const result = await rpc[parsed.method](parsed.input)
          postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
        } catch (error) {
          postMessage(
            JSON.stringify({
              type: "rpc.error",
              error: error instanceof Error ? error.message : String(error),
              id: parsed.id,
            }),
          )
        }
      }
    }
    // Bun can drop messages posted during the worker's asynchronous module load.
    // Publish readiness only after the request handler is installed.
    postMessage(JSON.stringify({ type: "rpc.ready" }))
  }

  export function emit(event: string, data: unknown) {
    postMessage(JSON.stringify({ type: "rpc.event", event, data }))
  }

  export function client<T extends Definition>(
    target: {
      postMessage: (data: string) => void | null
      onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
    },
    options: { startupTimeoutMs?: number } = {},
  ) {
    const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>()
    const queued: string[] = []
    let ready = false
    let startupError: Error | undefined
    const startupTimer = setTimeout(() => {
      startupError = new Error("Timed out waiting for RPC worker readiness")
      for (const request of pending.values()) request.reject(startupError)
      pending.clear()
      queued.length = 0
    }, options.startupTimeoutMs ?? 30_000)
    startupTimer.unref()
    const listeners = new Map<string, Set<(data: any) => void>>()
    let id = 0
    target.onmessage = async (evt) => {
      const parsed = JSON.parse(evt.data)
      if (parsed.type === "rpc.ready") {
        if (ready || startupError) return
        clearTimeout(startupTimer)
        ready = true
        for (const message of queued) target.postMessage(message)
        queued.length = 0
      }
      if (parsed.type === "rpc.result" || parsed.type === "rpc.error") {
        const request = pending.get(parsed.id)
        if (request) {
          pending.delete(parsed.id)
          if (parsed.type === "rpc.error") request.reject(new Error(parsed.error))
          else request.resolve(parsed.result)
        }
      }
      if (parsed.type === "rpc.event") {
        const handlers = listeners.get(parsed.event)
        if (handlers) {
          for (const handler of handlers) {
            handler(parsed.data)
          }
        }
      }
    }
    return {
      call<Method extends keyof T>(
        method: Method,
        input: Parameters<T[Method]>[0],
      ): Promise<Awaited<ReturnType<T[Method]>>> {
        const requestId = id++
        if (startupError) return Promise.reject(startupError)
        return new Promise((resolve, reject) => {
          pending.set(requestId, { resolve, reject })
          const message = JSON.stringify({ type: "rpc.request", method, input, id: requestId })
          if (ready) target.postMessage(message)
          else queued.push(message)
        })
      },
      on<Data>(event: string, handler: (data: Data) => void) {
        let handlers = listeners.get(event)
        if (!handlers) {
          handlers = new Set()
          listeners.set(event, handlers)
        }
        handlers.add(handler)
        return () => {
          handlers!.delete(handler)
        }
      },
    }
  }
}

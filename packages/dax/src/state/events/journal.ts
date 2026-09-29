import { Storage } from "@/storage/storage"

export type JournalLock = { dispose: () => Promise<void> }

export type JournalEvent = {
  eventId: string
  seq: number
  commandId?: string
}

export type JournalOptions<Event extends JournalEvent, Input> = {
  /** The owning scope is part of diagnostics, not an execution grant. */
  scope: { type: "run" | "project"; id: string }
  path: string[]
  lock: () => Promise<JournalLock>
  parse: (events: unknown[]) => Event[]
  create: (seq: number, input: Input) => Event
  validateAppend?: (existing: Event[], candidate: Event) => void | Promise<void>
  staleError: (expected: number, actual: number) => Error
  duplicateError: (commandId: string) => Error
}

/**
 * One storage and concurrency protocol for journals with independent owners.
 * Vocabulary, ownership validation, and reducer rules remain scope-specific.
 * A missing file is absence; a malformed or interrupted published log is never
 * repaired or projected as a shorter history.
 */
export class Journal<Event extends JournalEvent, Input> {
  constructor(private readonly options: JournalOptions<Event, Input>) {}

  private get eventsPath() {
    return [...this.options.path, "events.json"]
  }

  private get tempPath() {
    return [...this.options.path, "events.json.tmp"]
  }

  async read(): Promise<Event[]> {
    let raw: unknown
    try {
      raw = await Storage.read<unknown>(this.eventsPath)
    } catch (error) {
      if (Storage.NotFoundError.isInstance(error)) return []
      throw error
    }
    if (!Array.isArray(raw)) {
      throw new Error(`Invalid ${this.options.scope.type} journal ${this.options.scope.id}: expected an array`)
    }
    const events = this.options.parse(raw)
    const seenIds = new Set<string>()
    for (const [index, event] of events.entries()) {
      if (event.seq !== index) {
        throw new Error(
          `${this.options.scope.type} journal ${this.options.scope.id} is not contiguous at position ${index}: expected seq ${index}, found ${event.seq}`,
        )
      }
      if (seenIds.has(event.eventId)) {
        throw new Error(`${this.options.scope.type} journal ${this.options.scope.id} repeats eventId ${event.eventId}`)
      }
      seenIds.add(event.eventId)
    }
    return events
  }

  /** Caller already owns this journal's lock, including during initialization. */
  async appendUnderLock(
    expectedSeq: number,
    input: Input,
    existing: Event[],
    options?: { rejectDuplicateCommand?: boolean },
  ): Promise<Event> {
    const [result] = await this.appendBatchUnderLock(expectedSeq, [input], existing, options)
    return result
  }

  /** Validate every event under one scope lock, then publish the whole batch once. */
  async appendBatchUnderLock(
    expectedSeq: number,
    inputs: Input[],
    existing: Event[],
    options?: { rejectDuplicateCommand?: boolean },
  ): Promise<Event[]> {
    if (existing.length !== expectedSeq) throw this.options.staleError(expectedSeq, existing.length)
    if (inputs.length === 0) return []
    const next = [...existing]
    const results: Event[] = []
    for (const input of inputs) {
      const commandId = (input as { commandId?: string }).commandId
      if (commandId) {
        const duplicate = next.find((event) => event.commandId === commandId)
        if (duplicate) {
          if (options?.rejectDuplicateCommand) throw this.options.duplicateError(commandId)
          results.push(duplicate)
          continue
        }
      }

      const candidate = this.options.create(next.length, input)
      const [validated] = this.options.parse([candidate])
      if (!validated || validated.seq !== next.length) {
        throw new Error(`Invalid ${this.options.scope.type} journal candidate for ${this.options.scope.id}`)
      }
      if (next.some((event) => event.eventId === validated.eventId)) {
        throw new Error(`${this.options.scope.type} journal ${this.options.scope.id} repeats eventId ${validated.eventId}`)
      }
      await this.options.validateAppend?.(next, validated)
      next.push(validated)
      results.push(validated)
    }
    if (next.length > existing.length) {
      await Storage.write(this.tempPath, next)
      await Storage.rename(this.tempPath, this.eventsPath)
    }
    return results
  }

  async append(expectedSeq: number, input: Input, options?: { rejectDuplicateCommand?: boolean }): Promise<Event> {
    const lock = await this.options.lock()
    try {
      return await this.appendUnderLock(expectedSeq, input, await this.read(), options)
    } finally {
      await lock.dispose()
    }
  }

  async appendAtTail(input: Input, options?: { rejectDuplicateCommand?: boolean }): Promise<Event> {
    const lock = await this.options.lock()
    try {
      const events = await this.read()
      return await this.appendUnderLock(events.length, input, events, options)
    } finally {
      await lock.dispose()
    }
  }
}

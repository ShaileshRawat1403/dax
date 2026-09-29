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
  validateAppend?: (existing: Event[], candidate: Event) => void
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
    if (existing.length !== expectedSeq) throw this.options.staleError(expectedSeq, existing.length)

    const commandId = (input as { commandId?: string }).commandId
    if (commandId) {
      const duplicate = existing.find((event) => event.commandId === commandId)
      if (duplicate) {
        if (options?.rejectDuplicateCommand) throw this.options.duplicateError(commandId)
        return duplicate
      }
    }

    const candidate = this.options.create(expectedSeq, input)
    const [validated] = this.options.parse([candidate])
    if (!validated || validated.seq !== expectedSeq) {
      throw new Error(`Invalid ${this.options.scope.type} journal candidate for ${this.options.scope.id}`)
    }
    if (existing.some((event) => event.eventId === validated.eventId)) {
      throw new Error(`${this.options.scope.type} journal ${this.options.scope.id} repeats eventId ${validated.eventId}`)
    }
    this.options.validateAppend?.(existing, validated)
    const next = [...existing, validated]
    await Storage.write(this.tempPath, next)
    await Storage.rename(this.tempPath, this.eventsPath)
    return validated
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

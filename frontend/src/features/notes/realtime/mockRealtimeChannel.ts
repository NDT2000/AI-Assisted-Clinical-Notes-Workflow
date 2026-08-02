import type {
  MockRealtimeConnectOptions,
  MockRealtimeConnection,
  NoteRealtimeEvent,
  PublishNoteRealtimeEvent,
} from "./realtimeTypes";

interface ConnectionRecord {
  id: string;
  noteIds: Set<string>;
  onEvent: (
    event: NoteRealtimeEvent,
  ) => void;
  onDisconnect: (
    reason: Error,
  ) => void;
  connected: boolean;
  droppedDeliveriesRemaining: number;
}

export interface MockRealtimeChannelOptions {
  now?: () => string;
  maxEventLogSize?: number;
}

export const DEFAULT_MAX_REALTIME_EVENT_LOG_SIZE =
  5_000;

function normalizeCursor(
  cursor: number,
): number {
  if (!Number.isFinite(cursor)) {
    return 0;
  }

  return Math.max(
    0,
    Math.floor(cursor),
  );
}

function cloneEvent(
  event: NoteRealtimeEvent,
): NoteRealtimeEvent {
  if (
    event.type ===
    "note.status_changed"
  ) {
    return {
      ...event,
      response: {
        ...event.response,
        note: {
          ...event.response.note,
        },
        currentVersion: {
          ...event.response.currentVersion,
          content: {
            ...event.response
              .currentVersion.content,
          },
        },
        timelineEvent: {
          ...event.response.timelineEvent,
        },
      },
    };
  }

  if (
    event.type ===
    "note.version_added"
  ) {
    return {
      ...event,
      response: {
        ...event.response,
        note: {
          ...event.response.note,
        },
        savedVersion: {
          ...event.response.savedVersion,
          content: {
            ...event.response.savedVersion
              .content,
          },
        },
      },
    };
  }

  return {
    ...event,
    presence: event.presence.map(
      entry => ({
        ...entry,
        user: {
          ...entry.user,
        },
      }),
    ),
  };
}

function createEvent(
  input: PublishNoteRealtimeEvent,
  cursor: number,
  occurredAt: string,
): NoteRealtimeEvent {
  const eventId =
    input.eventId ??
    `note-realtime-${cursor}`;

  if (
    input.type ===
    "note.status_changed"
  ) {
    return cloneEvent({
      type: input.type,
      eventId,
      cursor,
      noteId: input.noteId,
      occurredAt:
        input.occurredAt ??
        occurredAt,
      trigger: input.trigger,
      response: input.response,
    });
  }

  if (
    input.type ===
    "note.version_added"
  ) {
    return cloneEvent({
      type: input.type,
      eventId,
      cursor,
      noteId: input.noteId,
      occurredAt:
        input.occurredAt ??
        occurredAt,
      response: input.response,
    });
  }

  return cloneEvent({
    type: input.type,
    eventId,
    cursor,
    noteId: input.noteId,
    occurredAt:
      input.occurredAt ??
      occurredAt,
    presence: input.presence,
  });
}

export class MockRealtimeChannel {
  private readonly now: () => string;

  private readonly maxEventLogSize:
    number;

  private readonly eventLog:
    NoteRealtimeEvent[] = [];

  private readonly eventById =
    new Map<string, NoteRealtimeEvent>();

  private readonly connections =
    new Map<string, ConnectionRecord>();

  private nextCursor = 1;

  private nextConnectionId = 1;

  private failedConnectionsRemaining = 0;

  constructor(
    options:
      MockRealtimeChannelOptions = {},
  ) {
    this.now =
      options.now ??
      (() => new Date().toISOString());

    this.maxEventLogSize =
      Math.max(
        1,
        Math.floor(
          options.maxEventLogSize ??
            DEFAULT_MAX_REALTIME_EVENT_LOG_SIZE,
        ),
      );
  }

  connect(
    options:
      MockRealtimeConnectOptions,
  ): MockRealtimeConnection {
    if (
      this.failedConnectionsRemaining >
      0
    ) {
      this.failedConnectionsRemaining -=
        1;

      throw new Error(
        "The mock real-time connection failed.",
      );
    }

    const id =
      `mock-realtime-connection-${this.nextConnectionId}`;

    this.nextConnectionId += 1;

    const record:
      ConnectionRecord = {
        id,
        noteIds: new Set(
          options.noteIds,
        ),
        onEvent: options.onEvent,
        onDisconnect:
          options.onDisconnect,
        connected: true,
        droppedDeliveriesRemaining: 0,
      };

    this.connections.set(
      id,
      record,
    );

    const afterCursor =
      normalizeCursor(
        options.afterCursor,
      );

    for (const event of this.eventLog) {
      if (
        event.cursor > afterCursor
      ) {
        this.deliverToConnection(
          record,
          event,
        );
      }
    }

    return {
      id,

      updateNoteIds: noteIds => {
        if (!record.connected) {
          return;
        }

        record.noteIds =
          new Set(noteIds);
      },

      disconnect: () => {
        this.disconnectRecord(
          record,
          false,
        );
      },
    };
  }

  publish(
    input: PublishNoteRealtimeEvent,
  ): NoteRealtimeEvent {
    if (
      input.eventId !== undefined
    ) {
      const existing =
        this.eventById.get(
          input.eventId,
        );

      if (existing !== undefined) {
        this.deliver(existing);
        return cloneEvent(existing);
      }
    }

    const event = createEvent(
      input,
      this.nextCursor,
      this.now(),
    );

    this.nextCursor += 1;

    this.eventLog.push(event);
    this.eventById.set(
      event.eventId,
      event,
    );

    this.trimLog();
    this.deliver(event);

    return cloneEvent(event);
  }

  duplicateEvent(
    eventId: string,
  ): boolean {
    const event =
      this.eventById.get(eventId);

    if (event === undefined) {
      return false;
    }

    this.deliver(event);
    return true;
  }

  dropNextDeliveriesForAll(
    count = 1,
  ): void {
    const normalizedCount =
      Math.max(
        0,
        Math.floor(count),
      );

    for (
      const connection of
      this.connections.values()
    ) {
      connection
        .droppedDeliveriesRemaining +=
        normalizedCount;
    }
  }

  failNextConnections(
    count = 1,
  ): void {
    this.failedConnectionsRemaining +=
      Math.max(
        0,
        Math.floor(count),
      );
  }

  forceDisconnectAll(
    message =
      "The mock real-time connection was interrupted.",
  ): void {
    const connections = [
      ...this.connections.values(),
    ];

    for (const record of connections) {
      if (!record.connected) {
        continue;
      }

      record.connected = false;
      this.connections.delete(
        record.id,
      );

      record.onDisconnect(
        new Error(message),
      );
    }
  }

  getEventsAfter(
    cursor: number,
    noteIds?: readonly string[],
  ): readonly NoteRealtimeEvent[] {
    const noteIdSet =
      noteIds === undefined
        ? null
        : new Set(noteIds);

    return this.eventLog
      .filter(
        event =>
          event.cursor >
            normalizeCursor(cursor) &&
          (noteIdSet === null ||
            noteIdSet.has(
              event.noteId,
            )),
      )
      .map(cloneEvent);
  }

  getLatestCursor(): number {
    return this.nextCursor - 1;
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  reset(): void {
    const connections = [
      ...this.connections.values(),
    ];

    for (const record of connections) {
      this.disconnectRecord(
        record,
        false,
      );
    }

    this.eventLog.length = 0;
    this.eventById.clear();
    this.nextCursor = 1;
    this.nextConnectionId = 1;
    this.failedConnectionsRemaining = 0;
  }

  private deliver(
    event: NoteRealtimeEvent,
  ): void {
    for (
      const connection of
      this.connections.values()
    ) {
      this.deliverToConnection(
        connection,
        event,
      );
    }
  }

  private deliverToConnection(
    connection: ConnectionRecord,
    event: NoteRealtimeEvent,
  ): void {
    if (
      !connection.connected ||
      !connection.noteIds.has(
        event.noteId,
      )
    ) {
      return;
    }

    if (
      connection
        .droppedDeliveriesRemaining >
      0
    ) {
      connection
        .droppedDeliveriesRemaining -=
        1;

      return;
    }

    connection.onEvent(
      cloneEvent(event),
    );
  }

  private disconnectRecord(
    record: ConnectionRecord,
    notify: boolean,
  ): void {
    if (!record.connected) {
      return;
    }

    record.connected = false;

    this.connections.delete(
      record.id,
    );

    if (notify) {
      record.onDisconnect(
        new Error(
          "The mock real-time connection was disconnected.",
        ),
      );
    }
  }

  private trimLog(): void {
    while (
      this.eventLog.length >
      this.maxEventLogSize
    ) {
      const removed =
        this.eventLog.shift();

      if (removed === undefined) {
        return;
      }

      const indexed =
        this.eventById.get(
          removed.eventId,
        );

      if (
        indexed?.cursor ===
        removed.cursor
      ) {
        this.eventById.delete(
          removed.eventId,
        );
      }
    }
  }
}

export const mockRealtimeChannel =
  new MockRealtimeChannel();

import type {
  MockRealtimeConnectOptions,
  MockRealtimeConnection,
  RealtimeChannel,
} from "./realtimeTypes";

/*
 * The app's channel: note changes come from the server; presence ("who is
 * viewing") still comes from the in-browser channel that this browser's
 * tabs share, until the server takes it over.
 *
 * Presence events carry cursor 0 so they never move the server cursor
 * that catching up relies on.
 */
export function createAppRealtimeChannel(
  server: RealtimeChannel,
  local: RealtimeChannel,
): RealtimeChannel {
  return {
    updatesNoteIdsInPlace: server.updatesNoteIdsInPlace,
    reportsCaughtUp: server.reportsCaughtUp,

    connect(
      options: MockRealtimeConnectOptions,
    ): MockRealtimeConnection {
      const remote = server.connect(options);
      const presence = local.connect({
        noteIds: options.noteIds,
        afterCursor: 0,
        onEvent: (event) => {
          if (event.type === "note.presence_changed") {
            options.onEvent({ ...event, cursor: 0 });
          }
        },
        onDisconnect: () => undefined,
      });

      return {
        id: remote.id,
        updateNoteIds(noteIds) {
          remote.updateNoteIds(noteIds);
          presence.updateNoteIds(noteIds);
        },
        disconnect() {
          remote.disconnect();
          presence.disconnect();
        },
      };
    },
  };
}

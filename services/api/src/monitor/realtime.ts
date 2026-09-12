/**
 * Telling a connected student, right now, that something arrived.
 *
 * Authority: Phase 7B.5 §14, §21, §29–§32, §90–§95, §97
 *
 * ---------------------------------------------------------------------------
 * THE DATABASE IS THE NOTIFICATION. THIS IS A DOORBELL.
 * ---------------------------------------------------------------------------
 *
 * A row is persisted and committed before anything here runs, so a socket that
 * is closed, slow or on fire costs a student nothing: the notification is
 * already theirs and waits in the inbox. Nothing below may ever be allowed to
 * fail a run, and nothing below is retried — a missed doorbell is answered by
 * the client reading the authoritative list on reconnect (§22, §26).
 *
 * ---------------------------------------------------------------------------
 * WHY POSTGRES AND NOT A BROKER
 * ---------------------------------------------------------------------------
 *
 * The worker is a different PROCESS from the API — a cron job and a web server.
 * An `EventEmitter` in one cannot be heard by the other, so something has to
 * cross that boundary.
 *
 * `LISTEN`/`NOTIFY` is already installed, already connected to, and already
 * authenticated. Redis would be a second piece of infrastructure to deploy,
 * secure and page somebody about; Kafka would be that plus a cluster — for a
 * university that publishes a handful of notices a day. §90 and §91 rule both
 * out and this needs neither.
 *
 * The seam is `publish` and `subscribe`. Swapping in Redis pub/sub later is a
 * change to this file and nothing else: the worker keeps calling `publish`, the
 * route keeps calling `subscribe`, and neither knows what carries the message
 * (§30, §93).
 *
 * ---------------------------------------------------------------------------
 * ONE INSTANCE, AND SAYING SO
 * ---------------------------------------------------------------------------
 *
 * Connections are tracked in a `Map` in this process. Two API instances would
 * each hold half the connections — and `LISTEN` broadcasts to every listening
 * session, so both would be notified and each would reach the students it
 * happens to hold. That is correct, not broken, which is a pleasant accident of
 * using the database: this design already survives horizontal scaling for
 * delivery, and only the `Map` is per-instance (§97).
 *
 * WHAT WOULD JUSTIFY A REAL BUS LATER (§98): several independent consumers of
 * these events, event volume Postgres cannot carry, durable replay, or fanout
 * across services. None of those is true, so none of them is built.
 */

import type { Sql } from '../db/client.js';
import type { Importance, SourceCategory } from './classify.js';

/** The channel name. One, because there is one kind of event. */
export const CHANNEL = 'gradtools_notification';

/**
 * What a connected client is told.
 *
 * ONLY WHAT IT NEEDS TO RENDER A ROW (§21, §80). No profile state, no USN, no
 * matching internals, no worker bookkeeping. `userId` is the addressing and is
 * stripped before the event reaches a browser — the connection already knows
 * whose it is, and echoing it back would be the one field with no purpose.
 */
export interface NotificationCreated {
  readonly type: 'notification.created';
  readonly userId: string;
  readonly notificationId: string;
  readonly category: SourceCategory;
  readonly importance: Importance;
  readonly title: string;
  readonly sourceUrl: string;
  readonly reason: string;
}

/** What actually goes down the wire, once the addressing is removed. */
export type ClientEvent = Omit<NotificationCreated, 'userId'>;

export function forClient(event: NotificationCreated): ClientEvent {
  const { userId: _addressed, ...rest } = event;
  return rest;
}

/**
 * Rings the doorbell. Never throws.
 *
 * A caller that had to wrap this in try/catch would eventually forget, and the
 * forgetting would turn a cosmetic delivery problem into a failed monitoring
 * run. So it swallows, and returns whether it worked, for the metrics §111
 * asks for.
 */
export async function publish(sql: Sql, event: NotificationCreated): Promise<boolean> {
  try {
    /*
     * `pg_notify` rather than `NOTIFY`, because the payload is a parameter.
     * `NOTIFY` takes a string literal, which would mean interpolating a VTU
     * document's title into SQL text.
     */
    await sql`SELECT pg_notify(${CHANNEL}, ${JSON.stringify(event)})`;
    return true;
  } catch {
    return false;
  }
}

type Listener = (event: NotificationCreated) => void;

/**
 * The connected students in THIS process.
 *
 * A set per user, because one person may have the app open on a phone and a
 * laptop and both should light up.
 */
const listeners = new Map<string, Set<Listener>>();

/** How many connections one account may hold at once (§150, §154). */
export const MAX_CONNECTIONS_PER_USER = 4;

export function connectionCount(): number {
  let total = 0;
  for (const set of listeners.values()) total += set.size;
  return total;
}

/**
 * Registers one connection, and returns how to forget it.
 *
 * THE RETURNED FUNCTION IS NOT OPTIONAL. An SSE route that fails to call it on
 * `close` leaks a listener and, through it, a response object — which is the
 * classic way a long-lived streaming endpoint runs a server out of memory over
 * a week (§28, §151).
 *
 * Returns null when the account already holds the maximum. Refusing is better
 * than accepting and growing without bound: the student still has their inbox.
 */
export function addListener(userId: string, listener: Listener): (() => void) | null {
  const held = listeners.get(userId) ?? new Set<Listener>();
  if (held.size >= MAX_CONNECTIONS_PER_USER) return null;
  held.add(listener);
  listeners.set(userId, held);

  return () => {
    const current = listeners.get(userId);
    if (current === undefined) return;
    current.delete(listener);
    /* An empty set is a leak the size of a uuid, so it goes too. */
    if (current.size === 0) listeners.delete(userId);
  };
}

/**
 * Hands one event to the connections it belongs to.
 *
 * THE ADDRESSING IS THE ONLY ROUTING. A listener registered for A is in A's
 * set and no other, so there is no path by which B's connection is reached —
 * the event is not filtered on the way out, it is delivered to a set that
 * cannot contain the wrong person (§17, §19).
 */
export function deliver(event: NotificationCreated): number {
  const held = listeners.get(event.userId);
  if (held === undefined) return 0;
  let delivered = 0;
  for (const listener of held) {
    try {
      listener(event);
      delivered += 1;
    } catch {
      /* One broken socket must not stop the others. */
    }
  }
  return delivered;
}

/** For tests, and for a clean shutdown. */
export function clearListeners(): void {
  listeners.clear();
}

/**
 * Opens the process's one `LISTEN` connection.
 *
 * ONE CONNECTION FOR THE WHOLE SERVER, not one per client. `LISTEN` is a
 * session-level thing, so a connection per connected student would put a
 * Postgres backend behind every open browser tab — which is how a notification
 * feature takes out a database.
 *
 * `postgres.js` reconnects its own listener, so a database restart does not
 * leave the process permanently deaf.
 */
let listening: Promise<{ stop: () => Promise<void> }> | null = null;

export async function startListening(sql: Sql): Promise<{ stop: () => Promise<void> }> {
  /*
   * ONCE PER PROCESS, ENFORCED.
   *
   * The comment above says one session for the whole server; this is what makes
   * it true. A second `LISTEN` on the same channel does not replace the first —
   * both fire, and every connected student is told twice. Found by a test that
   * built a second app in a process that already had one, which is exactly what
   * a test suite does and what a hot reload does.
   */
  if (listening !== null) return listening;

  listening = openListener(sql);
  return listening;
}

async function openListener(sql: Sql): Promise<{ stop: () => Promise<void> }> {
  const handle = await (
    sql as unknown as {
      listen: (
        channel: string,
        onNotify: (payload: string) => void,
      ) => Promise<{ unlisten: () => Promise<void> }>;
    }
  ).listen(CHANNEL, (payload: string) => {
    try {
      /*
       * The payload came out of the database, where the worker put it. It is
       * still parsed defensively: a channel is a name, not a permission, and
       * anything able to connect can notify on it.
       */
      const event = JSON.parse(payload) as NotificationCreated;
      if (event.type !== 'notification.created' || typeof event.userId !== 'string') return;
      deliver(event);
    } catch {
      /* A payload we cannot read is a dropped doorbell, not an outage. */
    }
  });

  return {
    stop: async () => {
      listening = null;
      await handle.unlisten();
    },
  };
}

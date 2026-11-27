/**
 * Android system notifications for VTU notices, with the GradTools chime
 * (res/raw/gradtools_chime.wav) on a channel of their own. Native only.
 *
 * A notice is posted only when ALL of these hold (`noticesToPost`):
 *   - it came from the live feed, not the bundled dated snapshot;
 *   - `buildNotifications` kept it: established as this student's (a targeted
 *     notice matching their profile, or one stated to be for every student),
 *     category not muted, still unread;
 *   - it was published or updated within the last NOTIFY_WINDOW_DAYS;
 *   - this version of it (id + updatedAt) has not been posted on this device.
 * The first time the feed is seen, what is already there is recorded and not
 * posted, so an install never floods the shade with old notices. At most ten
 * at a time. The payload is the notice's own title and id: no profile data.
 */
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { Announcement } from '@gradtools/shared-types';

export const NOTICE_CHANNEL = 'gradtools-notices';
const POSTED_KEY = 'gradtools:v1:notified-ids';
const MAX_PER_BATCH = 10;
const MAX_REMEMBERED = 500;
export const NOTIFY_WINDOW_DAYS = 7;

let prepared: Promise<boolean> | null = null;

function prepare(): Promise<boolean> {
  prepared ??= (async () => {
    if (!Capacitor.isNativePlatform()) return false;
    let permission = await LocalNotifications.checkPermissions();
    if (permission.display !== 'granted')
      permission = await LocalNotifications.requestPermissions();
    if (permission.display !== 'granted') return false;
    await LocalNotifications.createChannel({
      id: NOTICE_CHANNEL,
      name: 'VTU notices',
      description: 'VTU results, exams, timetables and other notices',
      importance: 4,
      visibility: 1,
      sound: 'gradtools_chime.wav',
      vibration: true,
    });
    return true;
  })().catch(() => false);
  return prepared;
}

/** The posted versions, or null when this device has never recorded any. */
function posted(): Set<string> | null {
  try {
    const raw = window.localStorage.getItem(POSTED_KEY);
    return raw === null ? null : new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function remember(seen: Set<string>): void {
  try {
    window.localStorage.setItem(POSTED_KEY, JSON.stringify([...seen].slice(-MAX_REMEMBERED)));
  } catch {
    /* Storage unavailable: at worst a notice is posted again later. */
  }
}

/** One posting per content version: an updated notice is news again. */
export function versionKey(notice: Announcement): string {
  return `${notice.id}@${notice.updatedAt}`;
}

/**
 * Which notices may ring the phone now. Pure: the caller has already applied
 * relevance and mute (buildNotifications) and passes the snapshot flag.
 */
export function noticesToPost(
  notices: readonly Announcement[],
  seen: ReadonlySet<string>,
  now: Date,
  fromSnapshot: boolean,
): Announcement[] {
  if (fromSnapshot) return [];
  const since = now.getTime() - NOTIFY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return (
    notices
      .filter((notice) => {
        const latest = Math.max(
          Date.parse(notice.publishedAt ?? '') || 0,
          Date.parse(notice.updatedAt) || 0,
        );
        return latest >= since && latest <= now.getTime() + 60_000;
      })
      /* A bare id is how an earlier build recorded a posting. */
      .filter((notice) => !seen.has(versionKey(notice)) && !seen.has(notice.id))
      .slice(0, MAX_PER_BATCH)
  );
}

/** A stable positive 31-bit id for an announcement id. */
function numericId(id: string): number {
  let hash = 0;
  for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 2_147_483_647 || 1;
}

export async function postNewNotices(
  notices: readonly Announcement[],
  labelOf: (announcement: Announcement) => string,
  fromSnapshot: boolean,
): Promise<number> {
  if (fromSnapshot || notices.length === 0 || !(await prepare())) return 0;
  const seen = posted();
  if (seen === null) {
    /* First sight of the feed on this device: record it, ring for nothing. */
    remember(new Set(notices.map(versionKey)));
    return 0;
  }
  const fresh = noticesToPost(notices, seen, new Date(), fromSnapshot);
  if (fresh.length === 0) return 0;
  await LocalNotifications.schedule({
    notifications: fresh.map((notice) => ({
      id: numericId(notice.id),
      channelId: NOTICE_CHANNEL,
      title: `VTU · ${labelOf(notice)}`,
      body: notice.title,
      largeBody: notice.title,
      sound: 'gradtools_chime.wav',
      // Posted now, not at a time: without this the plugin opens the
      // "Alarms & reminders" settings screen on Android 12+.
      isExactNotification: false,
      extra: { announcementId: notice.id },
    })),
  });
  for (const notice of fresh) seen.add(versionKey(notice));
  remember(seen);
  return fresh.length;
}

let lastTestId: number | null = null;

/**
 * One test notice on the same channel, so the student can hear the chime.
 * A fresh id each time (the plugin marks notices alert-once), and the previous
 * test is removed first, so repeated taps never pile up.
 */
export async function postTestNotice(): Promise<'posted' | 'blocked'> {
  if (!(await prepare())) return 'blocked';
  if (lastTestId !== null)
    await LocalNotifications.cancel({ notifications: [{ id: lastTestId }] }).catch(() => undefined);
  lastTestId = (Date.now() % 2_000_000_000) + 1;
  await LocalNotifications.schedule({
    notifications: [
      {
        id: lastTestId,
        channelId: NOTICE_CHANNEL,
        title: 'GradTools · Test',
        body: 'This is how VTU notices sound on this phone.',
        sound: 'gradtools_chime.wav',
        isExactNotification: false,
      },
    ],
  });
  return 'posted';
}

let demoIds: number[] = [];

/**
 * The pitch demo: stored notices (at most 15) posted as phone notifications on
 * the same channel, so the chime rings and the shade fills. Each is titled
 * "Demo" so a real notice shown this way is never mistaken for one sent to
 * the student.
 * Android sounds the first and stays quiet for the rest of the burst, so it
 * rings once. A repeat replaces the previous demo rather than stacking it.
 */
export async function postDemoNotices(
  notices: readonly Announcement[],
  labelOf: (announcement: Announcement) => string,
): Promise<'posted' | 'blocked' | 'empty'> {
  if (notices.length === 0) return 'empty';
  if (!(await prepare())) return 'blocked';
  if (demoIds.length > 0)
    await LocalNotifications.cancel({ notifications: demoIds.map((id) => ({ id })) }).catch(
      () => undefined,
    );
  const base = (Date.now() % 1_000_000_000) + 1;
  const batch = notices.slice(0, 15);
  demoIds = batch.map((_, index) => base + index);
  await LocalNotifications.schedule({
    notifications: batch.map((notice, index) => ({
      id: base + index,
      channelId: NOTICE_CHANNEL,
      title: `Demo · VTU · ${labelOf(notice)}`,
      body: notice.title,
      largeBody: notice.title,
      sound: 'gradtools_chime.wav',
      isExactNotification: false,
      extra: { announcementId: notice.id },
    })),
  });
  return 'posted';
}

/** Calls `open` when the student taps one of these notifications. */
export function onNoticeTapped(open: () => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => undefined;
  const handle = LocalNotifications.addListener('localNotificationActionPerformed', () => open());
  return () => {
    void handle.then((listener) => listener.remove());
  };
}

/**
 * Android system notifications for relevant VTU notices, with the GradTools
 * chime (res/raw/gradtools_chime.wav) on a channel of their own.
 *
 * Native only: on the web this does nothing, as before. It posts each notice
 * once per device (the ids already posted are remembered), only notices that
 * `buildNotifications` already kept (relevant to the student, category not
 * muted, still unread), and at most ten at a time.
 */
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { Announcement } from '@gradtools/shared-types';

export const NOTICE_CHANNEL = 'gradtools-notices';
const POSTED_KEY = 'gradtools:v1:notified-ids';
const MAX_PER_BATCH = 10;

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
      description: 'Results, exams, timetables and other VTU notices relevant to you',
      importance: 4,
      visibility: 1,
      sound: 'gradtools_chime.wav',
      vibration: true,
    });
    return true;
  })().catch(() => false);
  return prepared;
}

function posted(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(POSTED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
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
): Promise<number> {
  if (notices.length === 0 || !(await prepare())) return 0;
  const seen = posted();
  const fresh = notices.filter((notice) => !seen.has(notice.id)).slice(0, MAX_PER_BATCH);
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
  for (const notice of fresh) seen.add(notice.id);
  try {
    window.localStorage.setItem(POSTED_KEY, JSON.stringify([...seen]));
  } catch {
    /* Storage unavailable: at worst a notice is posted again later. */
  }
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
 * The pitch demo: every stored notice (at most 15) posted again as phone
 * notifications on the same channel, so the chime rings and the shade fills.
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
      title: `VTU · ${labelOf(notice)}`,
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

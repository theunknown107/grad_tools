/**
 * Backup on this device: save this workspace's local data as a file, restore it.
 *
 * Authority: docs/51
 *
 * NOT the server export. "Download my data" returns what GradTools' servers
 * hold; this returns what THIS DEVICE holds, which includes the per-class
 * attendance record and date-specific timetable changes that never sync, and
 * works without an account. The copy below says which is which.
 */

import { useEffect, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { ConfirmDialog } from '../../components/ui/dialog.js';
import { Callout, toast } from '../../components/ui/feedback.js';
import { SectionTitle } from '../../components/ui/page.js';
import {
  BACKUP_COLLECTION_LABEL,
  BackupError,
  buildBackup,
  parseBackup,
  restoreBackup,
  summarizeBackup,
  type LocalBackup,
} from '../../repositories/local/backup.js';
import {
  storagePersistence,
  type StorageKey,
  type StoragePersistence,
} from '../../repositories/local/store.js';
import { useAuth } from './AuthContext.js';

const PERSISTENCE_COPY: Readonly<Record<StoragePersistence, string>> = {
  persistent:
    'This browser has agreed to keep GradTools’ data unless you clear it yourself. A backup file still protects you if you lose or reset this device.',
  best_effort:
    'This browser may clear GradTools’ data when space runs low, or after a long gap between visits. Keep a backup file.',
  unknown: 'This browser does not say whether it keeps GradTools’ data. Keep a backup file.',
};

function download(backup: LocalBackup): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `gradtools-backup-${backup.exportedAt.slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function LocalBackupCard({
  onRestored = () => window.location.reload(),
}: {
  /** After a restore every screen must re-read storage; reloading is the honest way. */
  readonly onRestored?: () => void;
}) {
  const { state } = useAuth();
  const scope = state.status === 'signed_in' ? state.identity.userId : null;
  const fileInput = useRef<HTMLInputElement>(null);
  const [persistence, setPersistence] = useState<StoragePersistence | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<LocalBackup | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void storagePersistence().then((value) => {
      if (active) setPersistence(value);
    });
    return () => {
      active = false;
    };
  }, []);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      download(await buildBackup(scope));
      toast('Backup file saved', { tone: 'success' });
    } catch {
      setError('Could not build the backup file. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const choose = async (file: File | undefined): Promise<void> => {
    setError(null);
    if (file === undefined) return;
    try {
      setPending(parseBackup(await file.text()));
      setRestoreError(null);
    } catch (failure) {
      setError(failure instanceof BackupError ? failure.message : 'Could not read that file.');
    }
  };

  const counts = pending === null ? [] : Object.entries(summarizeBackup(pending));

  return (
    <Card className="p-6">
      <SectionTitle>Backup on this device</SectionTitle>
      <p className="text-[13px] text-ink-2">
        Saves what GradTools holds on this device as a file you keep, including per-class attendance
        and date-specific timetable changes, which do not sync. The file is not encrypted: anyone
        who has it can read your records.
      </p>
      {scope !== null && (
        <p className="mt-2 text-[12px] text-ink-3">
          This is this device&rsquo;s copy of your account&rsquo;s workspace, not the export of what
          GradTools&rsquo; servers hold.
        </p>
      )}
      {persistence !== null && (
        <p className="mt-2 text-[12px] text-ink-3">{PERSISTENCE_COPY[persistence]}</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button icon={<Download />} loading={saving} onClick={() => void save()}>
          Save backup file
        </Button>
        <Button icon={<Upload />} variant="ghost" onClick={() => fileInput.current?.click()}>
          Restore from file
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          aria-label="Backup file to restore"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            void choose(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>
      <p className="mt-3 text-[12px] text-ink-3">
        Restoring fills an empty GradTools and never overwrites records already here.
      </p>
      {error !== null && (
        <Callout tone="warning" role="alert" className="mt-4">
          {error}
        </Callout>
      )}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        busy={restoring}
        error={restoreError}
        pendingStatus="Restoring your backup…"
        title="Restore this backup?"
        description={
          <>
            <span className="block">
              Backup from {pending?.exportedAt.slice(0, 10) ?? ''}. It contains:
            </span>
            <span className="mt-2 block">
              {counts.length === 0
                ? 'No records.'
                : counts
                    .map(
                      ([key, count]) =>
                        `${BACKUP_COLLECTION_LABEL[key as StorageKey] ?? key}: ${String(count)}`,
                    )
                    .join(' · ')}
            </span>
          </>
        }
        confirmLabel="Restore"
        onConfirm={() => {
          if (pending === null) return;
          setRestoring(true);
          setRestoreError(null);
          void restoreBackup(scope, pending)
            .then(() => {
              setPending(null);
              toast('Backup restored', { tone: 'success' });
              onRestored();
            })
            .catch((failure: unknown) => {
              setRestoreError(
                failure instanceof BackupError
                  ? failure.message
                  : 'The backup could not be restored. Nothing was changed.',
              );
            })
            .finally(() => setRestoring(false));
        }}
      />
    </Card>
  );
}

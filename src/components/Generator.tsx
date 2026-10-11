'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AppState, CardView } from '@/lib/actions';
import { jobsFor, runQueue, visibleWords, type Filter, type Job } from '@/lib/bulk';
import { downloadExport, generate, imageUrl, importZip, loadState, putWord } from '@/lib/client';
import type { SlotIndex, WordState } from '@/lib/types';

import { TopBar } from './TopBar';
import { WordCard, type SlotStatus } from './WordCard';

const NO_STATUS: [SlotStatus, SlotStatus, SlotStatus] = ['', '', ''];
const SAVE_DELAY = 400;

/** Whether a choice has been made since it last went out in a zip. */
function changedSinceExport(state: WordState): boolean {
  return state.selected !== null && (!state.exportedAt || (state.selectedAt ?? '') > state.exportedAt);
}

/**
 * The whole screen. It is loaded once; after that every change comes from the
 * answer to a request this page made, and is merged into the word it belongs
 * to. Nothing here navigates, submits a form or asks the server to re-render.
 */
export function Generator({ initial }: { initial: AppState }) {
  const [words, setWords] = useState<CardView[]>(initial.words);
  const [hasKey] = useState(initial.hasKey);
  const [filter, setFilter] = useState<Filter>('needs');
  const [status, setStatus] = useState<Record<string, [SlotStatus, SlotStatus, SlotStatus]>>({});
  const [run, setRun] = useState<{ stop: () => void } | null>(null);
  const [left, setLeft] = useState(0);
  const [importing, setImporting] = useState(false);
  const [zoom, setZoom] = useState<{ key: string; id: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null);

  const wordsRef = useRef(words);
  wordsRef.current = words;
  const busy = useRef(new Set<string>());
  const saves = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; text: string }>());
  const saving = useRef(new Map<string, Promise<void>>());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const runRef = useRef<{ stop: () => void } | null>(null);

  const notify = useCallback((message: string, tone: 'ok' | 'error' = 'ok') => {
    clearTimeout(toastTimer.current);
    setToast({ message, tone });
    toastTimer.current = setTimeout(() => setToast(null), tone === 'error' ? 7000 : 3500);
  }, []);

  const patch = useCallback((key: string, change: (state: WordState) => WordState) => {
    setWords((prev) => prev.map((w) => (w.key === key ? { ...w, state: change(w.state) } : w)));
  }, []);

  const setSlotStatus = useCallback((key: string, slot: SlotIndex, value: SlotStatus) => {
    setStatus((prev) => {
      const next = [...(prev[key] ?? NO_STATUS)] as [SlotStatus, SlotStatus, SlotStatus];
      next[slot] = value;
      return { ...prev, [key]: next };
    });
  }, []);

  // --- what to draw -----------------------------------------------------------

  /** Sends the description now, if one is waiting, and resolves once it is saved. */
  const flushSubject = useCallback(async (key: string) => {
    const waiting = saves.current.get(key);
    if (waiting) {
      clearTimeout(waiting.timer);
      saves.current.delete(key);
      const sent = (saving.current.get(key) ?? Promise.resolve())
        .then(() => putWord(key, { subject: waiting.text }))
        .then(() => undefined, () => notify('The description was not saved. Check that the app is still running on the Mac.', 'error'));
      saving.current.set(key, sent);
    }
    await saving.current.get(key);
  }, [notify]);

  const onSubject = useCallback((key: string, text: string) => {
    setWords((prev) => prev.map((w) => (w.key === key ? { ...w, subject: text } : w)));
    clearTimeout(saves.current.get(key)?.timer);
    saves.current.set(key, { text, timer: setTimeout(() => void flushSubject(key), SAVE_DELAY) });
  }, [flushSubject]);

  const onSubjectDone = useCallback((key: string) => void flushSubject(key), [flushSubject]);

  // Anything typed in the last moment still goes out when the tab is hidden or closed.
  useEffect(() => {
    const flushAll = () => { for (const key of [...saves.current.keys()]) void flushSubject(key); };
    document.addEventListener('visibilitychange', flushAll);
    window.addEventListener('pagehide', flushAll);
    return () => { document.removeEventListener('visibilitychange', flushAll); window.removeEventListener('pagehide', flushAll); };
  }, [flushSubject]);

  // --- generating -------------------------------------------------------------

  /** Makes one picture. Only that slot is touched, so a choice made meanwhile is not undone. */
  const runJob = useCallback(async ({ key, slot }: Job) => {
    const id = `${key}:${slot}`;
    if (busy.current.has(id)) return;
    busy.current.add(id);
    setSlotStatus(key, slot, 'busy');
    try {
      await flushSubject(key);
      const { state } = await generate(key, slot);
      patch(key, (old) => {
        const slots = [...old.slots] as WordState['slots'];
        slots[slot] = state.slots[slot];
        return old.selected === slot ? { ...old, slots, selected: null } : { ...old, slots };
      });
      setSlotStatus(key, slot, '');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not make the picture.';
      setSlotStatus(key, slot, `error:${message}`);
      // A missing or rejected key will fail every picture; stop asking.
      const kind = (error as { kind?: string }).kind;
      if (kind === 'no-key' || kind === 'rejected-key') runRef.current?.stop();
    } finally {
      busy.current.delete(id);
    }
  }, [flushSubject, patch, setSlotStatus]);

  const onGenerate = useCallback((key: string, slots: SlotIndex[]) => {
    for (const slot of slots) void runJob({ key, slot });
  }, [runJob]);

  const visible = useMemo(() => visibleWords(words, filter), [words, filter]);
  const emptySlots = useMemo(() => jobsFor(visible.filter((w) => w.subject.trim())).length, [visible]);

  function generateAll() {
    const jobs = jobsFor(visibleWords(wordsRef.current, filter).filter((w) => w.subject.trim()));
    if (!jobs.length) return;
    let remaining = jobs.length;
    setLeft(remaining);
    const queue = runQueue(jobs, async (job) => {
      await runJob(job);
      setLeft(--remaining);
    });
    runRef.current = queue;
    setRun(queue);
    void queue.done.then(() => {
      runRef.current = null;
      setRun(null);
      notify(remaining > 0 ? `Stopped. ${remaining} picture(s) were not made.` : 'All done. Have a look and choose.');
    });
  }

  // --- choosing ---------------------------------------------------------------

  const onChoose = useCallback(async (key: string, slot: SlotIndex | null) => {
    const before = wordsRef.current.find((w) => w.key === key)?.state;
    if (!before) return;
    patch(key, (old) => ({ ...old, selected: slot }));
    try {
      const { state } = await putWord(key, { selected: slot });
      patch(key, (old) => ({ ...old, selected: state.selected, selectedAt: state.selectedAt, madeFor: state.madeFor }));
    } catch (error) {
      patch(key, (old) => ({ ...old, selected: before.selected }));
      notify(`Not saved: ${error instanceof Error ? error.message : 'connection problem'}`, 'error');
    }
  }, [notify, patch]);

  // --- words in, pictures out -------------------------------------------------

  /** Takes the server's list, keeping what is being typed here. */
  function adopt(app: AppState) {
    setWords((prev) => {
      const typed = new Map(prev.filter((w) => saves.current.has(w.key)).map((w) => [w.key, w.subject]));
      return app.words.map((w) => (typed.has(w.key) ? { ...w, subject: typed.get(w.key)! } : w));
    });
  }

  async function onImport(file: File) {
    setImporting(true);
    try {
      await Promise.all([...saves.current.keys()].map(flushSubject));
      const app = await importZip(file);
      adopt(app);
      setStatus({});
      const need = app.words.filter((w) => !w.hasPicture).length;
      notify(`Imported ${app.words.length} words. ${need} need a picture.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not import that file.', 'error');
    } finally {
      setImporting(false);
    }
  }

  async function onExport(scope: 'all' | 'changed') {
    try {
      await downloadExport(scope);
      notify('Zip downloaded. In the content editor, press Import pictures and choose it.');
      adopt(await loadState());
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not build the zip.', 'error');
    }
  }

  // --- the full-size view -----------------------------------------------------

  useEffect(() => {
    if (!zoom) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoom(null); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [zoom]);
  const onZoom = useCallback((key: string, id: string) => setZoom({ key, id }), []);

  const chosen = visible.filter((w) => w.state.selected !== null).length;
  const levels = useMemo(() => {
    const groups: { level: number; words: CardView[] }[] = [];
    for (const word of visible) {
      const last = groups[groups.length - 1];
      if (last && last.level === word.level) last.words.push(word);
      else groups.push({ level: word.level, words: [word] });
    }
    return groups;
  }, [visible]);

  return (
    <div className="app">
      <TopBar
        filter={filter}
        onFilter={setFilter}
        chosen={chosen}
        total={visible.length}
        exportAll={words.filter((w) => w.state.selected !== null).length}
        exportChanged={words.filter((w) => changedSinceExport(w.state)).length}
        hasWords={words.length > 0}
        canGenerate={hasKey}
        emptySlots={emptySlots}
        running={run !== null}
        left={left}
        importing={importing}
        onImport={onImport}
        onExport={onExport}
        onGenerateAll={generateAll}
        onStop={() => run?.stop()}
      />

      {!hasKey && (
        <div className="banner" role="alert">NVIDIA_API_KEY is missing. Add it to .env.local and restart.</div>
      )}

      <main className="content">
        {words.length === 0 ? (
          <div className="empty">
            <h1>No words yet</h1>
            <p>Press Export zip in the content editor, then Import words here.</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="empty">
            <p>{filter === 'needs' ? 'Every word already has a picture in the editor.' : 'Every word has a choice.'} Switch to All to see them.</p>
          </div>
        ) : (
          levels.map((group) => (
            <section key={group.level} aria-label={`Level ${group.level}`}>
              <h2 className="level">Level {group.level}</h2>
              <div className="cards">
                {group.words.map((card) => (
                  <WordCard
                    key={card.key}
                    card={card}
                    status={status[card.key] ?? NO_STATUS}
                    canGenerate={hasKey}
                    onSubject={onSubject}
                    onSubjectDone={onSubjectDone}
                    onGenerate={onGenerate}
                    onChoose={onChoose}
                    onZoom={onZoom}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </main>

      {zoom && (
        <div className="zoom" role="dialog" aria-modal="true" aria-label="Picture, full size" onClick={() => setZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl(zoom.key, zoom.id)} alt="" />
          <button type="button" className="btn zoom-close" autoFocus onClick={() => setZoom(null)}>Close</button>
        </div>
      )}

      {toast && <div className={`toast ${toast.tone}`} role="status">{toast.message}</div>}
    </div>
  );
}

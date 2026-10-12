'use client';

import { memo } from 'react';

import type { CardView } from '@/lib/actions';
import { imageUrl } from '@/lib/client';
import { SOFT, type SlotIndex } from '@/lib/types';

/** '' idle, 'busy', or 'error:<what went wrong>'. A string so the card can be memoised. */
export type SlotStatus = string;

const SLOTS: SlotIndex[] = [0, 1, 2];

export const WordCard = memo(function WordCard(props: {
  card: CardView;
  status: [SlotStatus, SlotStatus, SlotStatus];
  canGenerate: boolean;
  onSubject: (key: string, text: string) => void;
  onSubjectDone: (key: string) => void;
  onGenerate: (key: string, slots: SlotIndex[]) => void;
  onSharpen: (key: string, slot: SlotIndex) => void;
  onChoose: (key: string, slot: SlotIndex | null) => void;
  onZoom: (key: string, id: string) => void;
}) {
  const { card, status } = props;
  const { state } = card;
  const empty = SLOTS.filter((i) => !state.slots[i] && status[i] !== 'busy');
  const anyBusy = status.includes('busy');

  return (
    <article className={`card ${state.selected !== null ? 'chosen' : ''}`} id={`word-${card.key}`}>
      <div className="card-head">
        <span className="glyph" lang="ti">{card.glyph}</span>
        <div className="card-title">
          <strong>{card.meaning || '(no meaning)'}</strong>
          <span className="muted small">
            {card.romanization ? `${card.romanization} · ` : ''}Letter <span lang="ti">{card.fidel}</span> · {card.key}
          </span>
        </div>
        <div className="grow" />
        {card.changed && <span className="badge warn" title="The spelling or meaning changed in the editor after this picture was chosen.">Word changed</span>}
        {card.hasPicture && <span className="badge">Has a picture in the editor</span>}
      </div>

      <label className="field">
        <span className="small muted">What to draw</span>
        <textarea
          rows={2}
          value={card.subject}
          maxLength={600}
          onChange={(e) => props.onSubject(card.key, e.target.value)}
          onBlur={() => props.onSubjectDone(card.key)}
        />
      </label>

      <div className="slots">
        {SLOTS.map((i) => {
          const slot = state.slots[i];
          const st = status[i];
          const selected = state.selected === i;
          const dimmed = state.selected !== null && !selected;
          // Measured when the picture was made. Older pictures have no measure and show no button.
          const soft = typeof slot?.sharp === 'number' && slot.sharp < SOFT;
          return (
            <div key={i} className={`slot ${selected ? 'selected' : ''} ${dimmed ? 'dimmed' : ''}`}>
              {slot ? (
                <button
                  type="button"
                  className="pick"
                  aria-pressed={selected}
                  aria-label={`Picture ${i + 1} for ${card.meaning}${selected ? ', chosen' : ''}`}
                  onClick={() => props.onChoose(card.key, selected ? null : i)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl(card.key, slot.id)} alt="" loading="lazy" decoding="async" width={1152} height={768} />
                  {selected && <span className="tick" aria-hidden="true">✓</span>}
                </button>
              ) : (
                <div className="blank">
                  {st.startsWith('error:') ? <span className="slot-error">{st.slice(6)}</span> : st === 'busy' ? null : <span className="muted small">Empty</span>}
                </div>
              )}
              {st === 'busy' && <div className="working" role="status"><span className="spinner" /><span className="sr">Making picture {i + 1}…</span></div>}
              <div className="slot-actions">
                {slot && (
                  <button type="button" className="btn tiny" onClick={() => props.onZoom(card.key, slot.id)} aria-label={`Show picture ${i + 1} larger`}>
                    Expand
                  </button>
                )}
                {slot && soft && (
                  <button
                    type="button"
                    className="btn tiny warn"
                    disabled={!props.canGenerate || st === 'busy'}
                    title="This picture came out soft. Sharpen redraws the same picture, crisp."
                    onClick={() => props.onSharpen(card.key, i)}
                  >
                    Sharpen
                  </button>
                )}
                {(slot || st.startsWith('error:')) && (
                  <button type="button" className="btn tiny" disabled={!props.canGenerate || st === 'busy'} onClick={() => props.onGenerate(card.key, [i])}>
                    {slot ? 'Redo' : 'Retry'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Always here and always the same height, so a card never changes size
          when its pictures arrive and the list below it never jumps. */}
      <div className="card-foot">
        {empty.length > 0 ? (
          <>
            <button type="button" className="btn small primary" disabled={!props.canGenerate || !card.subject.trim()} onClick={() => props.onGenerate(card.key, empty)}>
              {empty.length === 3 ? 'Generate 3 pictures' : `Generate ${empty.length} more`}
            </button>
            {!card.subject.trim() && <span className="small muted">Write what to draw first.</span>}
          </>
        ) : anyBusy ? (
          <span className="small muted">Generating…</span>
        ) : state.selected === null ? (
          <span className="small muted">Tap a picture to choose it.</span>
        ) : (
          <span className="small chosen-note">Picture {state.selected + 1} chosen. Tap it again to undo.</span>
        )}
      </div>
    </article>
  );
});

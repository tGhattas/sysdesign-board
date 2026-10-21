import { useMemo } from 'react';
import { CopyPlus, Trash2, BringToFront, SendToBack } from 'lucide-react';
import type { El } from '../../../shared/types';
import { store, useStore } from '../store';
import { COLOR_ORDER, strokeColor, fillColor } from '../palette';
import type { Style } from '../elements';
import { E } from '../engineRef';

const DRAW_TOOLS = ['rect', 'ellipse', 'diamond', 'arrow', 'line', 'pen', 'text', 'frame'];

export function StylePanel() {
  const ids = useStore((s) => s.selectedIds);
  const elements = useStore((s) => s.elements);
  const tool = useStore((s) => s.tool);
  const style = useStore((s) => s.style);
  const theme = useStore((s) => s.theme);
  const lib = useStore((s) => s.libraryOpen);
  const editing = useStore((s) => s.editingId);
  const sel = useMemo(() => elements.filter((e) => ids.includes(e.id)), [elements, ids]);

  const show = sel.length > 0 || DRAW_TOOLS.includes(tool);
  if (!show || editing) return null;

  // what we're styling: the selection, or the defaults for the next shape
  const sample: Partial<El> & Style = sel.length ? { ...style, ...sel[0] } : style;
  const types = new Set(sel.length ? sel.map((e) => e.type) : [toolType(tool)]);
  const has = (...t: string[]) => t.some((x) => types.has(x as any));
  const onlyComments = sel.length > 0 && sel.every((e) => e.type === 'comment');

  const apply = (p: Partial<El> & Partial<Style>) => {
    store.set((s) => ({ style: { ...s.style, ...(p as Partial<Style>) } }));
    if (sel.length) E.current?.updateSelected(() => p);
  };

  const fillable = has('rect', 'ellipse', 'diamond', 'component', 'frame', 'note');
  const linear = has('arrow', 'line');
  const texty = has('text', 'rect', 'ellipse', 'diamond', 'component', 'note', 'arrow', 'frame');

  return (
    <div className="float style-panel" style={{ left: lib ? 268 : 14 }} onPointerDown={(e) => e.stopPropagation()}>
      {!onlyComments && (
        <>
          <div className="sp-label">Stroke</div>
          <div className="swatches">
            {COLOR_ORDER.map((c) => (
              <button
                key={c}
                className={`swatch ${sample.stroke === c ? 'sel' : ''}`}
                style={{ background: strokeColor(c, theme) }}
                title={c}
                onClick={() => apply({ stroke: c })}
              />
            ))}
          </div>
          {fillable && (
            <>
              <div className="sp-label">Fill</div>
              <div className="swatches">
                <button className={`swatch none ${sample.fill === 'none' ? 'sel' : ''}`} title="No fill" onClick={() => apply({ fill: 'none' })} />
                {COLOR_ORDER.filter((c) => c !== 'ink').map((c) => (
                  <button
                    key={c}
                    className={`swatch ${sample.fill === c ? 'sel' : ''}`}
                    style={{ background: fillColor(c, theme) }}
                    title={c}
                    onClick={() => apply({ fill: c, ...(sample.fillStyle === 'none' ? { fillStyle: 'hachure' } : {}) })}
                  />
                ))}
              </div>
              {sample.fill !== 'none' && !has('note') && (
                <div className="seg" style={{ marginTop: 6 }}>
                  {(['hachure', 'cross-hatch', 'solid'] as const).map((f) => (
                    <button key={f} className={sample.fillStyle === f ? 'sel' : ''} title={f} onClick={() => apply({ fillStyle: f })}>
                      <FillIcon kind={f} />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {!has('note') && (
            <>
              <div className="sp-label">Stroke width</div>
              <div className="seg">
                {[1, 2, 4].map((w) => (
                  <button key={w} className={sample.strokeWidth === w ? 'sel' : ''} onClick={() => apply({ strokeWidth: w })} title={`${w}px`}>
                    <svg width="28" height="10"><path d="M2 5 Q14 2 26 5" stroke="currentColor" strokeWidth={w} fill="none" strokeLinecap="round" /></svg>
                  </button>
                ))}
              </div>
              <div className="sp-label">Stroke style</div>
              <div className="seg">
                {(['solid', 'dashed', 'dotted'] as const).map((d) => (
                  <button key={d} className={sample.strokeStyle === d ? 'sel' : ''} onClick={() => apply({ strokeStyle: d })} title={d}>
                    <svg width="28" height="10">
                      <path d="M2 5 L26 5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeDasharray={d === 'dashed' ? '6 4' : d === 'dotted' ? '0.5 4' : undefined} />
                    </svg>
                  </button>
                ))}
              </div>
              <div className="sp-label">Sketchiness</div>
              <div className="seg">
                {[
                  [0, 'Neat'],
                  [1, 'Pencil'],
                  [2, 'Doodle'],
                ].map(([r, l]) => (
                  <button key={r} className={sample.roughness === r ? 'sel' : ''} onClick={() => apply({ roughness: r as number })}>
                    {l}
                  </button>
                ))}
              </div>
            </>
          )}
          {linear && (
            <>
              <div className="sp-label">Route</div>
              <div className="seg">
                {(['straight', 'curve', 'elbow'] as const).map((r) => (
                  <button
                    key={r}
                    className={(sample.route ?? 'straight') === r ? 'sel' : ''}
                    title={r}
                    onClick={() => apply({ route: r, ...(r === 'curve' && !sample.bend ? { bend: 40 } : {}), ...(r !== 'curve' ? { bend: 0 } : {}) })}
                  >
                    <svg width="28" height="16">
                      <path
                        d={r === 'straight' ? 'M3 13 L25 3' : r === 'curve' ? 'M3 13 Q6 2 25 3' : 'M3 13 L14 13 L14 3 L25 3'}
                        stroke="currentColor"
                        strokeWidth={2}
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                ))}
              </div>
              {has('arrow') && (
                <>
                  <div className="sp-label">Arrowheads</div>
                  <div className="seg">
                    {(['none', 'arrow', 'triangle', 'dot'] as const).map((h) => (
                      <button key={'s' + h} className={(sample.startHead ?? 'none') === h ? 'sel' : ''} title={`start: ${h}`} onClick={() => apply({ startHead: h })}>
                        <HeadIcon kind={h} flip />
                      </button>
                    ))}
                  </div>
                  <div className="seg" style={{ marginTop: 4 }}>
                    {(['none', 'arrow', 'triangle', 'dot'] as const).map((h) => (
                      <button key={'e' + h} className={(sample.endHead ?? 'arrow') === h ? 'sel' : ''} title={`end: ${h}`} onClick={() => apply({ endHead: h })}>
                        <HeadIcon kind={h} />
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {texty && (
            <>
              <div className="sp-label">Text</div>
              <div className="seg">
                {[
                  [16, 'S'],
                  [20, 'M'],
                  [28, 'L'],
                  [40, 'XL'],
                ].map(([v, l]) => (
                  <button key={v} className={sample.fontSize === v ? 'sel' : ''} onClick={() => apply({ fontSize: v as number })}>
                    {l}
                  </button>
                ))}
              </div>
              <div className="seg" style={{ marginTop: 4 }}>
                {(
                  [
                    ['hand', 'Hand', 'var(--hand)'],
                    ['marker', 'Marker', 'var(--marker)'],
                    ['clean', 'Clean', 'var(--ui)'],
                  ] as const
                ).map(([f, l, css]) => (
                  <button key={f} className={(sample.font ?? 'hand') === f ? 'sel' : ''} onClick={() => apply({ font: f })} style={{ fontFamily: css, fontSize: f === 'marker' ? 16 : 13 }}>
                    {l}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {sel.length > 0 && (
        <div className="sp-actions" style={onlyComments ? { marginTop: 0, paddingTop: 0, border: 0 } : undefined}>
          <button className="icon-btn" title="Duplicate (⌘D)" onClick={() => E.current?.duplicateSelected()}>
            <CopyPlus size={16} />
          </button>
          <button className="icon-btn" title="Bring to front (⌘])" onClick={() => E.current?.reorder('front')}>
            <BringToFront size={16} />
          </button>
          <button className="icon-btn" title="Send to back (⌘[)" onClick={() => E.current?.reorder('back')}>
            <SendToBack size={16} />
          </button>
          <div style={{ flex: 1 }} />
          <button className="icon-btn" title="Delete (⌫)" onClick={() => E.current?.deleteSelected()} style={{ color: '#e03131' }}>
            <Trash2 size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function toolType(tool: string) {
  return tool === 'select' ? 'rect' : tool;
}

function FillIcon({ kind }: { kind: string }) {
  return (
    <svg width="22" height="16" viewBox="0 0 22 16">
      <defs>
        <clipPath id={`c-${kind}`}>
          <rect x="2" y="2" width="18" height="12" rx="3" />
        </clipPath>
      </defs>
      {kind === 'solid' ? (
        <rect x="2" y="2" width="18" height="12" rx="3" fill="currentColor" opacity="0.5" />
      ) : (
        <g clipPath={`url(#c-${kind})`} stroke="currentColor" strokeWidth="1.2">
          {[-12, -6, 0, 6, 12, 18].map((o) => (
            <line key={o} x1={o} y1="16" x2={o + 16} y2="0" />
          ))}
          {kind === 'cross-hatch' && [-12, -6, 0, 6, 12, 18].map((o) => <line key={'x' + o} x1={o} y1="0" x2={o + 16} y2="16" />)}
        </g>
      )}
      <rect x="2" y="2" width="18" height="12" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function HeadIcon({ kind, flip }: { kind: string; flip?: boolean }) {
  return (
    <svg width="28" height="14" viewBox="0 0 28 14" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M3 7 L24 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      {kind === 'arrow' && <path d="M18 2 L24 7 L18 12" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {kind === 'triangle' && <path d="M18 2 L25 7 L18 12 Z" fill="currentColor" />}
      {kind === 'dot' && <circle cx="23" cy="7" r="3.5" fill="currentColor" />}
    </svg>
  );
}

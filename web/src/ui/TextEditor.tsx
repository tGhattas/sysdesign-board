import { useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { E } from '../engineRef';
import { FONT_CSS, lineHeight } from '../elements';
import { strokeColor, THEME } from '../palette';
import { linearPath, pathMidpoint } from '../../../shared/geometry';
import { componentLayout } from '../render/renderer';

/** A textarea laid over the element being edited, matching the canvas font at the current zoom. */
export function TextEditor() {
  const editingId = useStore((s) => s.editingId);
  const el = useStore((s) => (s.editingId ? s.elements.find((e) => e.id === s.editingId) : undefined));
  const cam = useStore((s) => s.cam);
  const theme = useStore((s) => s.theme);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');
  const done = useRef(false);

  useLayoutEffect(() => {
    if (!editingId) return;
    done.current = false;
    setValue(el?.label ?? '');
    // focus synchronously so keystrokes typed right after the double-click land in the editor
    ref.current?.focus();
    ref.current?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  useLayoutEffect(() => {
    const t = ref.current;
    if (!t || !el) return;
    if (el.type === 'text') {
      t.style.width = '1px';
      t.style.width = t.scrollWidth + 4 + 'px';
    }
    t.style.height = 'auto';
    t.style.height = t.scrollHeight + 'px';
  }, [value, el, cam.zoom]);

  if (!editingId || !el) return null;
  const z = cam.zoom;
  const fs = (el.type === 'comment' ? 17 : el.fontSize ?? 20) * (el.font === 'marker' ? 1.25 : 1) * z;
  const font = el.font ?? 'hand';
  const toS = (x: number, y: number) => ({ left: (x - cam.x) * z, top: (y - cam.y) * z });

  let style: React.CSSProperties = {
    fontFamily: FONT_CSS[font],
    fontSize: fs,
    fontWeight: font === 'hand' ? 400 : 600,
    color: el.type === 'note' || el.type === 'comment' ? THEME[theme].ink : strokeColor(el.stroke, theme),
    lineHeight: `${lineHeight(el) * z}px`,
  };
  if (el.type === 'text') {
    style = { ...style, ...toS(el.x + 2, el.y), minWidth: 20, whiteSpace: 'pre' };
  } else if (el.type === 'arrow' || el.type === 'line') {
    const m = pathMidpoint(linearPath(el));
    const w = 200 * z;
    style = { ...style, ...toS(m.x, m.y), width: w, marginLeft: -w / 2, marginTop: -(lineHeight(el) * z) / 2, textAlign: 'center', whiteSpace: 'pre-wrap', background: THEME[theme].paper, borderRadius: 6 };
  } else if (el.type === 'note' || el.type === 'comment') {
    style = { ...style, ...toS(el.x + 14, el.y + (el.type === 'comment' ? 28 : 12)), width: (el.w - 28) * z, whiteSpace: 'pre-wrap' };
  } else if (el.type === 'frame') {
    style = { ...style, ...toS(el.x + 26, el.y - 12), width: 220 * z, fontSize: 16 * z, lineHeight: `${24 * z}px`, whiteSpace: 'pre', background: THEME[theme].paper };
  } else {
    let cy = el.y + el.h / 2;
    if (el.type === 'component') cy = componentLayout(el).labelY;
    const w = (el.w - 12) * z;
    style = { ...style, ...toS(el.x + 6, cy), width: w, textAlign: 'center', whiteSpace: 'pre-wrap', transform: 'translateY(-50%)' };
  }

  const commit = () => {
    if (done.current) return;
    done.current = true;
    E.current?.commitText(el.id, value);
  };

  return (
    <textarea
      ref={ref}
      className="text-editor"
      style={style}
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          commit();
        } else if (e.key === 'Enter' && !e.shiftKey && el.type !== 'text' && el.type !== 'note' && el.type !== 'comment') {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { CATALOG, CATEGORIES } from '../../../shared/catalog';
import type { ComponentKind } from '../../../shared/types';
import { useStore } from '../store';
import { makeComponent, DEFAULT_STYLE } from '../elements';
import { renderToCanvas } from '../render/renderer';
import { E } from '../engineRef';
import type { Theme } from '../palette';

const previewCache = new Map<string, string>();

function preview(kind: ComponentKind, theme: Theme, fontsReady: boolean) {
  const key = `${kind}:${theme}:${fontsReady}`;
  let url = previewCache.get(key);
  if (!url) {
    const el = makeComponent(kind, 0, 0, DEFAULT_STYLE, { id: `preview-${kind}`, seed: 42, label: '' });
    url = renderToCanvas([el], theme, { padding: 6, scale: 1.4, background: false }).toDataURL();
    previewCache.set(key, url);
  }
  return url;
}

export function Library() {
  const theme = useStore((s) => s.theme);
  const [q, setQ] = useState('');
  const [fontsReady, setFontsReady] = useState(false);
  useMemo(() => {
    document.fonts?.ready.then(() => setFontsReady(true));
  }, []);
  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? CATALOG.filter((c) => (c.name + ' ' + c.keywords + ' ' + c.kind).toLowerCase().includes(t)) : CATALOG;
  }, [q]);

  return (
    <div className="float library" onPointerDown={(e) => e.stopPropagation()}>
      <div className="head">
        <h3>Components</h3>
        <div className="search">
          <Search size={14} color="var(--ink-3)" />
          <input placeholder="Search — redis, kafka, s3…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="scroll">
        {CATEGORIES.map((cat) => {
          const list = items.filter((i) => i.category === cat);
          if (!list.length) return null;
          return (
            <div className="cat" key={cat}>
              <div className="cat-title">{cat}</div>
              <div className="tiles">
                {list.map((c) => (
                  <button
                    key={c.kind}
                    className="tile"
                    title={`${c.name} — click to add, or drag onto the board`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-sysdesign', c.kind);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => E.current?.addComponent(c.kind)}
                  >
                    <img src={preview(c.kind, theme, fontsReady)} alt="" />
                    <span>{c.name}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {!items.length && <div className="empty">Nothing matches “{q}”. Use a box and label it — interviewers care about the idea, not the icon.</div>}
      </div>
      <div className="lib-foot">Tip: hover a component and drag a blue dot to connect it.</div>
    </div>
  );
}

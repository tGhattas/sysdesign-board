import {
  MousePointer2, Hand, Square, Circle, Diamond, MoveUpRight, Minus, Pencil, Type, StickyNote, Frame, Eraser, Zap, Lock, LockOpen, Shapes,
} from 'lucide-react';
import { store, useStore, type Tool } from '../store';
import { E } from '../engineRef';

const TOOLS: { id: Tool; icon: any; label: string; key: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'Select', key: '1' },
  { id: 'hand', icon: Hand, label: 'Hand — pan the board', key: 'H' },
  { id: 'rect', icon: Square, label: 'Rectangle', key: '2' },
  { id: 'diamond', icon: Diamond, label: 'Diamond', key: '3' },
  { id: 'ellipse', icon: Circle, label: 'Ellipse', key: '4' },
  { id: 'arrow', icon: MoveUpRight, label: 'Arrow — drag between shapes to connect', key: '5' },
  { id: 'line', icon: Minus, label: 'Line', key: '6' },
  { id: 'pen', icon: Pencil, label: 'Pen', key: '7' },
  { id: 'text', icon: Type, label: 'Text', key: '8' },
  { id: 'note', icon: StickyNote, label: 'Sticky note', key: '9' },
  { id: 'frame', icon: Frame, label: 'Zone (VPC, region, service boundary)', key: 'F' },
  { id: 'eraser', icon: Eraser, label: 'Eraser', key: '0' },
  { id: 'laser', icon: Zap, label: 'Laser pointer — point at things while you explain', key: 'K' },
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const locked = useStore((s) => s.toolLocked);
  const lib = useStore((s) => s.libraryOpen);
  return (
    <div className="float toolbar" onPointerDown={(e) => e.stopPropagation()}>
      <button
        className="icon-btn"
        title={locked ? 'Tool stays active after drawing (Q)' : 'Keep the tool active after drawing (Q)'}
        onClick={() => store.set({ toolLocked: !locked })}
        style={locked ? { color: 'var(--accent)' } : undefined}
      >
        {locked ? <Lock size={16} /> : <LockOpen size={16} />}
      </button>
      <div className="sep" />
      {TOOLS.map((t, i) => (
        <span key={t.id} style={{ display: 'contents' }}>
          {(i === 2 || i === 7 || i === 11) && <div className="sep" />}
          <button className={`icon-btn ${tool === t.id ? 'active' : ''}`} title={`${t.label}  (${t.key})`} onClick={() => E.current?.setTool(t.id)}>
            <t.icon size={18} strokeWidth={tool === t.id ? 2.4 : 2} />
            <span className="kbd">{t.key}</span>
          </button>
        </span>
      ))}
      <div className="sep" />
      <button className={`lib-btn ${lib ? '' : 'off'}`} title="System design components (C)" onClick={() => store.set({ libraryOpen: !lib })}>
        <Shapes size={16} /> Components
      </button>
    </div>
  );
}

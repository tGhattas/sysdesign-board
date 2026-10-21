import { useEffect, useRef, useState } from 'react';
import { Engine } from './engine';
import { E } from './engineRef';
import { store, useStore } from './store';
import { connect } from './sync';
import { Toolbar } from './ui/Toolbar';
import { Library } from './ui/Library';
import { StylePanel } from './ui/StylePanel';
import { InterviewPanel } from './ui/InterviewPanel';
import { TextEditor } from './ui/TextEditor';
import { Brand, TopRight, ZoomBar, Toast, AiEye, EmptyHint, Help } from './ui/Chrome';
import type { ComponentKind } from '../../shared/types';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useStore((s) => s.theme);
  const lib = useStore((s) => s.libraryOpen);
  const panel = useStore((s) => s.panelOpen);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const engine = new Engine(canvasRef.current!);
    E.current = engine;
    connect(engine);
    if (store.get().elements.length && !localStorage.getItem('sysdesign-board:v1')) engine.fit();
    (window as any).__board = engine;
    return () => engine.destroy();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="app">
      <div
        className={`canvas-wrap ${dragOver ? 'drop-hint' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-sysdesign')) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          setDragOver(false);
          const kind = e.dataTransfer.getData('application/x-sysdesign') as ComponentKind;
          if (!kind || !E.current) return;
          e.preventDefault();
          const r = canvasRef.current!.getBoundingClientRect();
          E.current.addComponent(kind, E.current.toWorld(e.clientX - r.left, e.clientY - r.top));
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas ref={canvasRef} />
        <TextEditor />
      </div>
      <EmptyHint />
      <Brand />
      <Toolbar />
      {lib && <Library />}
      <StylePanel />
      {panel ? <InterviewPanel /> : <TopRight />}
      <ZoomBar />
      <AiEye />
      <Toast />
      <Help />
    </div>
  );
}

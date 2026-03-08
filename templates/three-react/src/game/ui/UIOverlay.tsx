import { useEffect, useRef } from 'react';
import { useGameStore } from '../../store';
import { HUD } from './HUD';
import { MenuScreen } from './MenuScreen';
import { SettingsPanel } from './settings';

function FPSCounter() {
  const fpsRef = useRef<HTMLSpanElement>(null);
  const dcRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let last = performance.now();

    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - last >= 500) {
        const fps = Math.round(frames / ((now - last) / 1000));
        frames = 0;
        last = now;
        if (fpsRef.current) {
          fpsRef.current.textContent = `${fps} fps`;
          fpsRef.current.style.color =
            fps >= 50 ? '#8f8' : fps >= 30 ? '#ff8' : '#f88';
        }
        if (dcRef.current) {
          dcRef.current.textContent = `${useGameStore.getState().drawCalls} dc`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        right: 12,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        fontFamily: 'monospace',
        fontWeight: 600,
        fontSize: 11,
        opacity: 0.7,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      <span ref={fpsRef} style={{ color: '#8f8' }}>-- fps</span>
      <span ref={dcRef} style={{ color: '#aaa' }}>0 dc</span>
    </div>
  );
}

export function UIOverlay() {
  const phase = useGameStore((s) => s.phase);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 10,
        fontFamily: "'Segoe UI', system-ui, sans-serif",
      }}
    >
      {phase === 'menu' && <MenuScreen />}
      {(phase === 'playing' || phase === 'paused') && <HUD />}
      <SettingsPanel />
      {phase === 'paused' && (
        <div
          style={{
            position: 'absolute',
            top: '40%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: '#fff',
            fontSize: '48px',
            fontWeight: 'bold',
            letterSpacing: '8px',
            textShadow: '0 0 20px rgba(0,0,0,0.8), 0 2px 4px rgba(0,0,0,0.6)',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          PAUSED
        </div>
      )}
      <FPSCounter />
    </div>
  );
}

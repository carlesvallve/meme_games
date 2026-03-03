import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../../store';
import { HUD } from './HUD';
import { MenuScreen } from './MenuScreen';
import { DeathOverlay } from './DeathOverlay';
import { DialogUI } from './DialogUI';
import { CharacterSelect } from './CharacterSelect';
import { SpeechBubbles } from './SpeechBubbles';
import { SettingsPanel } from './settings';
import { PotionHotbar } from './PotionHotbar';

function FPSCounter() {
  const ref = useRef<HTMLDivElement>(null);

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
        if (ref.current) {
          ref.current.textContent = `${fps} fps`;
          ref.current.style.color =
            fps >= 50 ? '#8f8' : fps >= 30 ? '#ff8' : '#f88';
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: 8,
        right: 12,
        color: '#8f8',
        fontSize: 11,
        fontFamily: 'monospace',
        fontWeight: 600,
        opacity: 0.7,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      -- fps
    </div>
  );
}

function PauseLabel() {
  return (
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
  );
}

export function UIOverlay() {
  const phase = useGameStore((s) => s.phase);
  const message = useGameStore((s) => s.message);

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
      {phase === 'select' && <CharacterSelect />}
      {(phase === 'playing' || phase === 'paused') && <HUD />}
      {(phase === 'playing' || phase === 'paused') && <SpeechBubbles />}
      {(phase === 'playing' || phase === 'paused') && <PotionHotbar />}
      <SettingsPanel />
      {phase === 'player_dead' && <DeathOverlay />}
      {phase === 'paused' && <PauseLabel />}
      {message && <DialogUI message={message} />}
      <FPSCounter />
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store';
import type { ParticleToggles } from '../store';

const TOGGLE_KEYS: { key: keyof ParticleToggles; label: string }[] = [
  { key: 'dust', label: 'Dust' },
  { key: 'lightRain', label: 'Drizzle' },
  { key: 'rain', label: 'Rain' },
  { key: 'debris', label: 'Debris' },
];

export function HUD() {
  const collectibles = useGameStore((s) => s.collectibles);
  const toggles = useGameStore((s) => s.particleToggles);
  const toggle = useGameStore((s) => s.toggleParticle);
  const [pop, setPop] = useState(false);
  const prevRef = useRef(collectibles);

  useEffect(() => {
    if (collectibles !== prevRef.current) {
      prevRef.current = collectibles;
      setPop(true);
      const t = setTimeout(() => setPop(false), 300);
      return () => clearTimeout(t);
    }
  }, [collectibles]);

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        right: 16,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        pointerEvents: 'auto',
        color: '#fff',
        textShadow: '0 1px 4px rgba(0,0,0,0.8)',
        fontSize: 18,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ opacity: 0.7, fontSize: 13 }}>
          WASD move &middot; Drag orbit &middot; Scroll zoom
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {TOGGLE_KEYS.map((t) => {
            const on = toggles[t.key];
            return (
              <button
                key={t.key}
                onClick={() => toggle(t.key)}
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: on ? '#fff' : 'rgba(255,255,255,0.4)',
                  background: on
                    ? 'rgba(255,255,255,0.2)'
                    : 'rgba(255,255,255,0.04)',
                  border: on
                    ? '1px solid rgba(255,255,255,0.4)'
                    : '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 5,
                  cursor: 'pointer',
                  letterSpacing: 0.5,
                  transition: 'all 0.15s',
                  minWidth: 44,
                  minHeight: 28,
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 14, opacity: 0.7 }}>COLLECTIBLES</div>
        <div
          style={{
            fontSize: 32,
            fontWeight: 700,
            transform: pop ? 'scale(1.3)' : 'scale(1)',
            transition: 'transform 0.15s ease-out',
            color: pop ? '#44ffaa' : '#fff',
          }}
        >
          {collectibles}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store';
import type { ParticleToggles } from '../store';

const TOGGLE_KEYS: { key: keyof ParticleToggles; label: string }[] = [
  { key: 'dust', label: 'Dust' },
  { key: 'lightRain', label: 'Drizzle' },
  { key: 'rain', label: 'Rain' },
  { key: 'debris', label: 'Debris' },
];

function usePop(value: number): boolean {
  const [pop, setPop] = useState(false);
  const prevRef = useRef(value);
  useEffect(() => {
    if (value !== prevRef.current) {
      prevRef.current = value;
      setPop(true);
      const t = setTimeout(() => setPop(false), 300);
      return () => clearTimeout(t);
    }
  }, [value]);
  return pop;
}

function StatRow({ icon, label, value, color }: {
  icon: string;
  label: string;
  value: number;
  color: string;
}) {
  const pop = usePop(value);
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 4,
    }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <span style={{ fontSize: 11, opacity: 0.6, letterSpacing: 1 }}>{label}</span>
      <span style={{
        fontSize: 18,
        fontWeight: 700,
        marginLeft: 2,
        transform: pop ? 'scale(1.25)' : 'scale(1)',
        transition: 'transform 0.15s ease-out',
        color: pop ? color : '#fff',
        transformOrigin: 'right center',
        display: 'inline-block',
      }}>
        {value}
      </span>
    </div>
  );
}

export function HUD() {
  const collectibles = useGameStore((s) => s.collectibles);
  const coins = useGameStore((s) => s.coins);
  const potions = useGameStore((s) => s.potions);
  const toggles = useGameStore((s) => s.particleToggles);
  const toggle = useGameStore((s) => s.toggleParticle);

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
        pointerEvents: 'none',
        color: '#fff',
        textShadow: '0 1px 4px rgba(0,0,0,0.8)',
        fontSize: 18,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, pointerEvents: 'auto' }}>
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

      {/* Right-side vertical stats */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        alignItems: 'flex-end',
      }}>
        <StatRow icon="💎" label="GEMS" value={collectibles} color="#44ffaa" />
        <StatRow icon="🪙" label="COINS" value={coins} color="#ffd700" />
        <StatRow icon="🧪" label="POTIONS" value={potions} color="#ff6688" />
      </div>
    </div>
  );
}

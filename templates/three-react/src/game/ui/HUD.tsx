import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../store';
import type { ParticleToggles, ActivePotionDisplay } from '../../store';
import { EFFECT_META } from '../combat';

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

function Stat({
  icon,
  value,
  color,
}: {
  icon: string;
  value: number;
  color: string;
}) {
  const pop = usePop(value);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 3,
      }}
    >
      <span style={{ fontSize: 12 }}>{icon}</span>
      <span
        style={{
          fontSize: 14,
          fontWeight: 700,
          transform: pop ? 'scale(1.25)' : 'scale(1)',
          transition: 'transform 0.15s ease-out',
          color: pop ? color : '#fff',
          display: 'inline-block',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function HPBar({ hp, maxHp }: { hp: number; maxHp: number }) {
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  const color = ratio > 0.5 ? '#44dd66' : ratio > 0.25 ? '#ddaa22' : '#dd3333';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 2,
      }}
    >
      <div
        style={{
          width: 120,
          height: 8,
          background: 'rgba(255,255,255,0.15)',
          borderRadius: 4,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${ratio * 100}%`,
            height: '100%',
            background: color,
            borderRadius: 4,
            transition: 'width 0.2s ease-out, background 0.2s',
          }}
        />
      </div>
      <span style={{ fontSize: 10, opacity: 0.7, letterSpacing: 1 }}>
        {hp} / {maxHp}
      </span>
    </div>
  );
}

function HungerBar({
  hunger,
  maxHunger,
}: {
  hunger: number;
  maxHunger: number;
}) {
  const ratio = maxHunger > 0 ? hunger / maxHunger : 0;
  const color = ratio > 0.4 ? '#cc8833' : ratio > 0.2 ? '#cc6622' : '#cc3322';
  const flash = hunger <= 20;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 2,
      }}
    >
      <div
        style={{
          width: 120,
          height: 6,
          background: 'rgba(255,255,255,0.15)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${ratio * 100}%`,
            height: '100%',
            background: color,
            borderRadius: 3,
            transition: 'width 0.3s ease-out, background 0.3s',
            animation: flash ? 'hungerFlash 0.8s infinite alternate' : 'none',
          }}
        />
      </div>
      <span style={{ fontSize: 9, opacity: 0.5, letterSpacing: 1 }}>
        {Math.round(hunger)} / {maxHunger}
      </span>
    </div>
  );
}

/** Simple SVG icon paths (16x16 viewBox) — flat, solid, no emoji */
function SvgIcon({
  path,
  color,
  size = 14,
}: {
  path: string;
  color: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 16 16'
      fill={color}
      style={{ display: 'block' }}
    >
      <path d={path} />
    </svg>
  );
}

const EFFECT_SVG: Record<string, { path: string; color: string }> = {
  heal: {
    path: 'M8 2C6.3 2 4 3.6 4 6.4c0 3.2 4 7.6 4 7.6s4-4.4 4-7.6C12 3.6 9.7 2 8 2z',
    color: '#ff4466',
  },
  poison: {
    path: 'M8 1a2 2 0 0 0-2 2v2.5L4 8v1h1v4a3 3 0 0 0 6 0V9h1V8l-2-2.5V3a2 2 0 0 0-2-2zM7 10a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm2.5 2a1 1 0 1 1 0-2 1 1 0 0 1 0 2z',
    color: '#88dd44',
  },
  speed: { path: 'M13 3L7 8h4l-5 6 2-4.5H5L9 3h4z', color: '#ffcc22' },
  slow: {
    path: 'M8 1C4.1 1 1 4.1 1 8s3.1 7 7 7 7-3.1 7-7-3.1-7-7-7zm0 12.5c-3 0-5.5-2.5-5.5-5.5S5 2.5 8 2.5 13.5 5 13.5 8 11 13.5 8 13.5zM8.5 4H7v5l4 2.4.8-1.2-3.3-2V4z',
    color: '#8888cc',
  },
  armor: {
    path: 'M8 1L2 4v4c0 4 2.7 6.6 6 8 3.3-1.4 6-4 6-8V4L8 1z',
    color: '#55aaff',
  },
  fragile: {
    path: 'M8 14s-6-4.4-6-8.4C2 3.3 4.3 1 7 1c1 0 1.8.5 1 1.2C7.2.5 8 0 9 1c2.7 0 5 2.3 5 4.6 0 4-6 8.4-6 8.4zM6 6l4 4M10 6l-4 4',
    color: '#dd6644',
  },
  shadow: {
    path: 'M8 2C5.2 2 3 4.2 3 7c0 1.6.8 3 2 4v2a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2c1.2-1 2-2.4 2-4 0-2.8-2.2-5-5-5zm0 2a3 3 0 0 1 3 3c0 1-.5 1.8-1.3 2.4l-.7.5V12H7v-2.1l-.7-.5C5.5 8.8 5 8 5 7a3 3 0 0 1 3-3z',
    color: '#aa88ff',
  },
  frenzy: {
    path: 'M8 1c-.6 2-2.5 3.5-2.5 6C5.5 9.5 6.6 11 8 11s2.5-1.5 2.5-4C10.5 4.5 8.6 3 8 1zM8 13c-1 0-1.8-.5-2.2-1.2C4 12.5 3 13.8 3 15h10c0-1.2-1-2.5-2.8-3.2-.4.7-1.2 1.2-2.2 1.2z',
    color: '#ff6622',
  },
  clarity: {
    path: 'M8 3C5.8 3 4 4.8 4 7s1.8 4 4 4 4-1.8 4-4-1.8-4-4-4zm0 6.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zM8 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM3 2l1.5 1.5M13 2l-1.5 1.5M3 12l1.5-1.5M13 12l-1.5-1.5',
    color: '#44ddff',
  },
  confusion: {
    path: 'M8 2C6 2 5 3.5 5.5 5c.3.8 1 1.2 1 2s-.5 1.5-1 2.5C5 10.5 5.5 12 7 13c1 .7 2.5.5 3-.5.3-.6 0-1.2-.5-1.5s-1-.5-1-1.2c0-.5.5-1 1-1.5s1.5-1 2-2c.7-1.3.3-3-1-4C10 1.5 9 2 8 2zm0 12a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
    color: '#dd44ff',
  },
};

function ActiveEffects({ effects }: { effects: ActivePotionDisplay[] }) {
  if (effects.length === 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        gap: 4,
        justifyContent: 'flex-end',
      }}
    >
      {effects.map(({ effect, remaining, duration, positive }) => {
        const ratio = duration > 0 ? remaining / duration : 0;
        const color = positive ? '#44dd66' : '#dd4444';
        const bgColor = positive
          ? 'rgba(68,221,102,0.15)'
          : 'rgba(221,68,68,0.15)';
        const borderColor = positive
          ? 'rgba(68,221,102,0.4)'
          : 'rgba(221,68,68,0.4)';
        const svgData = EFFECT_SVG[effect];
        const iconColor = svgData?.color ?? color;
        const secs = Math.ceil(remaining);
        return (
          <div
            key={effect}
            style={{
              position: 'relative',
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: bgColor,
              border: `1.5px solid ${borderColor}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {/* Timer fill from bottom */}
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: `${ratio * 100}%`,
                background: positive
                  ? 'rgba(68,221,102,0.25)'
                  : 'rgba(221,68,68,0.25)',
                transition: 'height 0.25s linear',
              }}
            />
            {/* SVG icon */}
            <div style={{ position: 'relative', zIndex: 1 }}>
              {svgData ? (
                <SvgIcon path={svgData.path} color={iconColor} size={14} />
              ) : (
                <span style={{ fontSize: 12, color }}>
                  {effect[0].toUpperCase()}
                </span>
              )}
            </div>
            {/* Timer text */}
            <span
              style={{
                position: 'absolute',
                bottom: -1,
                right: -1,
                fontSize: 7,
                fontWeight: 700,
                color,
                background: 'rgba(0,0,0,0.7)',
                borderRadius: 3,
                padding: '0 2px',
                lineHeight: '10px',
                zIndex: 2,
              }}
            >
              {secs}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Zone announcement overlay — fades in, holds, fades out */
function ZoneAnnouncement() {
  const announcement = useGameStore((s) => s.zoneAnnouncement);
  const [visible, setVisible] = useState(false);
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    if (!announcement) {
      setVisible(false);
      setOpacity(0);
      return;
    }
    setVisible(true);
    // Fade in
    requestAnimationFrame(() => setOpacity(1));
    // Hold then fade out
    const fadeOut = setTimeout(() => setOpacity(0), 2500);
    // Hide after fade completes
    const hide = setTimeout(() => {
      setVisible(false);
      useGameStore.getState().setZoneAnnouncement(null);
    }, 3500);
    return () => {
      clearTimeout(fadeOut);
      clearTimeout(hide);
    };
  }, [announcement]);

  if (!visible || !announcement) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        opacity,
        transition: 'opacity 0.8s ease-in-out',
        zIndex: 50,
      }}
    >
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: 3,
          textTransform: 'uppercase',
          color: '#fff',
          textShadow: '0 0 20px rgba(0,0,0,0.9), 0 2px 8px rgba(0,0,0,0.7)',
        }}
      >
        {announcement.title}
      </div>
      {announcement.subtitle && (
        <div
          style={{
            fontSize: 14,
            fontWeight: 400,
            letterSpacing: 1,
            color: 'rgba(255,255,255,0.7)',
            textShadow: '0 0 10px rgba(0,0,0,0.8)',
            marginTop: 8,
            fontStyle: 'italic',
          }}
        >
          {announcement.subtitle}
        </div>
      )}
    </div>
  );
}

export function HUD() {
  const collectibles = useGameStore((s) => s.collectibles);
  const coins = useGameStore((s) => s.coins);
  const potionCount = useGameStore((s) =>
    s.potionInventory.reduce((sum, slot) => sum + slot.count, 0),
  );
  const hp = useGameStore((s) => s.hp);
  const maxHp = useGameStore((s) => s.maxHp);
  const hunger = useGameStore((s) => s.hunger);
  const maxHunger = useGameStore((s) => s.maxHunger);
  const toggles = useGameStore((s) => s.particleToggles);
  const toggle = useGameStore((s) => s.toggleParticle);
  const activeCharacterName = useGameStore((s) => s.activeCharacterName);
  const activeCharacterColor = useGameStore((s) => s.activeCharacterColor);
  const activePotionEffects = useGameStore((s) => s.activePotionEffects);
  const floor = useGameStore((s) => s.floor);
  const zoneName = useGameStore((s) => s.zoneName);

  return (
    <>
      <ZoneAnnouncement />
      <div
        style={{
          position: 'absolute',
          top: 28,
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
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            pointerEvents: 'auto',
          }}
        >
          <div style={{ opacity: 0.7, fontSize: 13 }}>
            WASD move &middot; Drag orbit &middot; Scroll zoom &middot; ←→ cycle
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

        {/* Right-side stats */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            alignItems: 'flex-end',
          }}
        >
          {/* Floor + Zone */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 2,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: 1,
                color: 'rgba(255,255,255,0.5)',
                textTransform: 'uppercase',
              }}
            >
              {zoneName}
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: 1,
                color: '#aaccff',
                background: 'rgba(100,150,255,0.15)',
                border: '1px solid rgba(100,150,255,0.3)',
                borderRadius: 4,
                padding: '1px 6px',
              }}
            >
              F{floor}
            </span>
          </div>
          {activeCharacterName && (
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
                color: activeCharacterColor ?? '#6af',
                marginBottom: 2,
              }}
            >
              {activeCharacterName}
            </div>
          )}
          <ActiveEffects effects={activePotionEffects} />
          <HPBar hp={hp} maxHp={maxHp} />
          <HungerBar hunger={hunger} maxHunger={maxHunger} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Stat icon='💎' value={collectibles} color='#44ffaa' />
            <Stat icon='🪙' value={coins} color='#ffd700' />
          </div>
        </div>
      </div>
    </>
  );
}

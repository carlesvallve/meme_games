import { useGameStore } from '../store';
import { CHARACTER_TEAM_COLORS, getSlots, voxRoster } from '../game/characters';

/** Per-hero emoji for the character select grid */
const HERO_ICONS: Record<string, string> = {
  adventurer: '🧭',
  alchemist: '⚗️',
  amazon: '🔱', // spear/glaive, melee
  archer: '🏹',
  barbarian: '🪓',
  bard: '🎵',
  knight: '⚔️',
  mage: '✨',
  monk: '☯️',
  necromancer: '💀',
  priestess: '🙏',
  rogue: '🎭',
};

export function CharacterSelect() {
  const selectCharacter = useGameStore((s) => s.selectCharacter);
  const slots = getSlots();

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)',
        pointerEvents: 'auto',
      }}
    >
      <h2
        style={{
          color: '#fff',
          fontSize: 32,
          fontWeight: 700,
          margin: '0 0 8px',
          letterSpacing: 3,
          textShadow: '0 2px 8px rgba(0,0,0,0.5)',
          textAlign: 'center',
          width: '90%',
        }}
      >
        CHOOSE YOUR CHARACTER
      </h2>
      <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, margin: '0 0 32px' }}>
        Select a character to start exploring
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
          maxWidth: 560,
          width: '90%',
          maxHeight: '60vh',
          overflowY: 'auto',
        }}
      >
        {slots.map((slot) => {
          const color = CHARACTER_TEAM_COLORS[slot];
          const entry = voxRoster[slot];
          const icon = HERO_ICONS[entry.id] ?? '⚔️';
          return (
            <button
              key={slot}
              onClick={() => selectCharacter(slot)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '10px 6px',
                background: 'rgba(20,20,40,0.9)',
                border: `2px solid ${color}`,
                borderRadius: 8,
                cursor: 'pointer',
                transition: 'transform 0.15s, box-shadow 0.15s',
                minWidth: 0,
                minHeight: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.06)';
                e.currentTarget.style.boxShadow = `0 2px 12px ${color}66`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = 'none';
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.transform = 'scale(0.96)';
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = 'scale(1.06)';
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 4, lineHeight: 1 }}>
                {icon}
              </div>
              <div
                style={{
                  width: 20,
                  height: 3,
                  borderRadius: 2,
                  background: color,
                  marginBottom: 6,
                }}
              />
              <div
                style={{
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: 0.5,
                  textAlign: 'center',
                  lineHeight: 1.2,
                }}
              >
                {entry.name}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

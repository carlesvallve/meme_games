import { useGameStore } from '../store';
import { CHARACTER_TEAM_COLORS, getSlots, voxRoster } from '../game/characters';

const CATEGORY_ICON: Record<string, string> = {
  hero: '\u2694\ufe0f',
  enemy: '\ud83d\udc79',
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
          gap: 16,
          maxWidth: 600,
          width: '90%',
        }}
      >
        {slots.map((slot) => {
          const color = CHARACTER_TEAM_COLORS[slot];
          const entry = voxRoster[slot];
          const icon = CATEGORY_ICON[entry.category] ?? '\u2694\ufe0f';
          return (
            <button
              key={slot}
              onClick={() => selectCharacter(slot)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '20px 12px',
                background: 'rgba(20,20,40,0.9)',
                border: `2px solid ${color}`,
                borderRadius: 12,
                cursor: 'pointer',
                transition: 'transform 0.15s, box-shadow 0.15s',
                minWidth: 44,
                minHeight: 44,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.08)';
                e.currentTarget.style.boxShadow = `0 4px 20px ${color}66`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = 'none';
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.transform = 'scale(0.95)';
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = 'scale(1.08)';
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 8 }}>
                {icon}
              </div>
              <div
                style={{
                  width: 32,
                  height: 4,
                  borderRadius: 2,
                  background: color,
                  marginBottom: 8,
                }}
              />
              <div
                style={{
                  color: '#fff',
                  fontSize: 16,
                  fontWeight: 600,
                  letterSpacing: 1,
                }}
              >
                {entry.name}
              </div>
              <div
                style={{
                  color: 'rgba(255,255,255,0.4)',
                  fontSize: 11,
                  marginTop: 4,
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                }}
              >
                {entry.category}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

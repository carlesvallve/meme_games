import { useGameStore } from '../store';
import { CHARACTER_TEAM_COLORS, CHARACTER_NAMES } from '../game/characters';
import type { CharacterType } from '../game/characters';

const CHARACTERS: CharacterType[] = ['boy', 'girl', 'robot', 'dog'];

const ICONS: Record<CharacterType, string> = {
  boy: '\u2694\ufe0f',
  girl: '\u2728',
  robot: '\u2699\ufe0f',
  dog: '\ud83d\udc3e',
};

export function CharacterSelect() {
  const selectCharacter = useGameStore((s) => s.selectCharacter);

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
        {CHARACTERS.map((type) => {
          const color = CHARACTER_TEAM_COLORS[type];
          const name = CHARACTER_NAMES[type];
          return (
            <button
              key={type}
              onClick={() => selectCharacter(type)}
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
                {ICONS[type]}
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
                {name}
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
                {type}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

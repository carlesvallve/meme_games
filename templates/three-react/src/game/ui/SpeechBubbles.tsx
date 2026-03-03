import { useGameStore } from '../../store';
import { CHARACTER_TEAM_COLORS } from '../character';

export function SpeechBubbles() {
  const bubbles = useGameStore((s) => s.speechBubbles);
  const character = useGameStore((s) => s.selectedCharacter);
  const borderColor = character ? CHARACTER_TEAM_COLORS[character] : '#e94560';

  if (bubbles.length === 0) return null;

  return (
    <>
      {bubbles.map((b) => (
        <div
          key={b.id}
          style={{
            position: 'absolute',
            left: b.x,
            top: b.y,
            transform: 'translate(-50%, -100%)',
            pointerEvents: 'none',
            opacity: b.opacity,
            transition: 'opacity 0.15s',
            zIndex: 0,
          }}
        >
          <div
            style={{
              position: 'relative',
              background: 'rgba(10,10,20,0.88)',
              border: `1.5px solid ${borderColor}`,
              borderRadius: 10,
              padding: '6px 14px',
              color: '#e0e0ee',
              fontSize: 13,
              fontWeight: 500,
              whiteSpace: 'nowrap',
              textShadow: '0 1px 2px rgba(0,0,0,0.5)',
              boxShadow: `0 2px 12px rgba(0,0,0,0.4), 0 0 8px ${borderColor}33`,
            }}
          >
            {b.text}
          </div>
          {/* Tail — outer (border color) */}
          <div
            style={{
              position: 'relative',
              width: 0,
              height: 0,
              margin: '-1px auto 0',
              borderLeft: '8px solid transparent',
              borderRight: '8px solid transparent',
              borderTop: `10px solid ${borderColor}`,
            }}
          />
          {/* Tail — inner (background fill) */}
          <div
            style={{
              position: 'relative',
              width: 0,
              height: 0,
              margin: '-11px auto 0',
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: '8px solid rgba(10,10,20,0.88)',
            }}
          />
        </div>
      ))}
    </>
  );
}

import { useGameStore } from '../../store';

export function DeathOverlay() {
  const phase = useGameStore((s) => s.phase);

  if (phase !== 'player_dead') return null;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(transparent 30%, rgba(0,0,0,0.4) 100%)',
        pointerEvents: 'none',
        transition: 'background 0.3s ease',
      }}
    />
  );
}

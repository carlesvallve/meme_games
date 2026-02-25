import { useEffect, useState } from 'react';
import { useGameStore } from '../store';

const COOLDOWN_MS = 2500;

export function DeathOverlay() {
  const phase = useGameStore((s) => s.phase);
  const playerDeadAt = useGameStore((s) => s.playerDeadAt);
  const setPhase = useGameStore((s) => s.setPhase);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    if (phase !== 'player_dead' || playerDeadAt == null) return;
    const elapsed = Date.now() - playerDeadAt;
    if (elapsed >= COOLDOWN_MS) {
      setShowPrompt(true);
      return;
    }
    const t = setTimeout(() => setShowPrompt(true), COOLDOWN_MS - elapsed);
    return () => clearTimeout(t);
  }, [phase, playerDeadAt]);

  useEffect(() => {
    if (phase !== 'player_dead' || !showPrompt) return;
    const goToMenu = () => setPhase('menu');
    const onKeydown = () => goToMenu();
    const onClick = () => {
      if (useGameStore.getState().lastPointerUpWasAfterDrag) {
        useGameStore.getState().setLastPointerUpWasAfterDrag(false);
        return;
      }
      goToMenu();
    };
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('click', onClick);
    window.addEventListener('touchstart', goToMenu, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('click', onClick);
      window.removeEventListener('touchstart', goToMenu);
    };
  }, [phase, showPrompt, setPhase]);

  if (phase !== 'player_dead') return null;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingBottom: 80,
        background: showPrompt ? 'linear-gradient(transparent 40%, rgba(0,0,0,0.5) 100%)' : 'transparent',
        pointerEvents: 'none',
        transition: 'background 0.3s ease',
      }}
    >
      {showPrompt && (
        <p
          style={{
            color: 'rgba(255,255,255,0.9)',
            fontSize: 18,
            margin: 0,
            textShadow: '0 1px 4px rgba(0,0,0,0.8)',
          }}
        >
          Press any key or tap to continue
        </p>
      )}
    </div>
  );
}

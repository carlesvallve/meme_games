import { useGameStore } from '../store';
import { HUD } from './HUD';
import { MenuScreen } from './MenuScreen';
import { DeathOverlay } from './DeathOverlay';
import { DialogUI } from './DialogUI';
import { CharacterSelect } from './CharacterSelect';
import { SpeechBubbles } from './SpeechBubbles';
import { SettingsPanel } from './SettingsPanel';

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
      {(phase === 'playing' || phase === 'paused') && <SettingsPanel />}
      {phase === 'player_dead' && <DeathOverlay />}
      {phase === 'paused' && <PauseLabel />}
      {message && <DialogUI message={message} />}
    </div>
  );
}

import { useGameStore } from '../store';
import { HUD } from './HUD';
import { MenuScreen } from './MenuScreen';
import { DialogUI } from './DialogUI';
import { CharacterSelect } from './CharacterSelect';
import { SpeechBubbles } from './SpeechBubbles';
import { SettingsPanel } from './SettingsPanel';

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
      {phase === 'playing' && <SpeechBubbles />}
      {phase === 'playing' && <SettingsPanel />}
      {phase === 'paused' && <MenuScreen />}
      {phase === 'gameover' && <MenuScreen />}
      {message && <DialogUI message={message} />}
    </div>
  );
}

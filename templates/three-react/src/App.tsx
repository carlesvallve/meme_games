import { GameCanvas } from './game/GameCanvas';
import { UIOverlay } from './game/ui/UIOverlay';

export function App() {
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <GameCanvas />
      <UIOverlay />
    </div>
  );
}

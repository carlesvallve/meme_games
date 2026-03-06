import { useGameStore } from '../../store';

export function HUD() {
  const settingsPanelOpen = useGameStore((s) => s.settingsPanelOpen);

  return (
    <div
      style={{
        position: 'absolute',
        top: 28,
        left: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        pointerEvents: 'none',
        color: '#fff',
        textShadow: '0 1px 4px rgba(0,0,0,0.8)',
        fontSize: 12,
        fontFamily: 'monospace',
        opacity: 0.6,
      }}
    >
      {!settingsPanelOpen && (
        <span>WASD / Arrows: orbit camera | Scroll: zoom</span>
      )}
    </div>
  );
}

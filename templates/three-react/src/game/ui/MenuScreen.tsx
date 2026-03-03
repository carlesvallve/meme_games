import { useGameStore } from '../../store';

export function MenuScreen() {
  const phase = useGameStore((s) => s.phase);
  const isPaused = phase === 'paused';

  const title = isPaused ? 'PAUSED' : 'THREE REACT';
  const subtitle = isPaused ? 'Press ESC to resume' : 'Voxel character demo';
  const buttonText = isPaused ? 'RESUME' : 'START';

  const handleClick = () => {
    if (isPaused) {
      useGameStore.getState().onPauseToggle?.();
    } else {
      useGameStore.getState().onStartGame?.();
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: isPaused ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.6)',
        pointerEvents: 'none',
      }}
    >
      <h1
        style={{
          color: '#fff',
          fontSize: 48,
          fontWeight: 800,
          margin: 0,
          letterSpacing: 4,
          textShadow: '0 2px 8px rgba(0,0,0,0.5)',
        }}
      >
        {title}
      </h1>
      <p
        style={{
          color: 'rgba(255,255,255,0.7)',
          fontSize: 18,
          margin: '12px 0 32px',
        }}
      >
        {subtitle}
      </p>
      <button
        onClick={handleClick}
        style={{
          pointerEvents: 'auto',
          padding: '14px 48px',
          fontSize: 20,
          fontWeight: 700,
          color: '#fff',
          background: 'linear-gradient(135deg, #e94560, #c23152)',
          border: 'none',
          borderRadius: 8,
          cursor: 'pointer',
          letterSpacing: 2,
          boxShadow: '0 4px 16px rgba(233,69,96,0.4)',
          transition: 'transform 0.15s, box-shadow 0.15s',
          minWidth: 44,
          minHeight: 44,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.05)';
          e.currentTarget.style.boxShadow = '0 6px 24px rgba(233,69,96,0.6)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = '0 4px 16px rgba(233,69,96,0.4)';
        }}
        onMouseDown={(e) => {
          e.currentTarget.style.transform = 'scale(0.97)';
        }}
        onMouseUp={(e) => {
          e.currentTarget.style.transform = 'scale(1.05)';
        }}
      >
        {buttonText}
      </button>
    </div>
  );
}

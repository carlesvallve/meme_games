import { useGameStore } from '../../store';

interface DialogUIProps {
  message: string;
}

export function DialogUI({ message }: DialogUIProps) {
  const dismiss = () => {
    useGameStore.getState().showMessage(null);
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
        pointerEvents: 'auto',
      }}
      onClick={dismiss}
    >
      <div
        style={{
          background: 'rgba(20,20,40,0.95)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 12,
          padding: '24px 32px',
          maxWidth: 400,
          color: '#fff',
          fontSize: 16,
          lineHeight: 1.5,
          textAlign: 'center',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p style={{ margin: '0 0 16px' }}>{message}</p>
        <button
          onClick={dismiss}
          style={{
            padding: '8px 24px',
            fontSize: 14,
            color: '#fff',
            background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 6,
            cursor: 'pointer',
            minWidth: 44,
            minHeight: 44,
          }}
        >
          OK
        </button>
      </div>
    </div>
  );
}

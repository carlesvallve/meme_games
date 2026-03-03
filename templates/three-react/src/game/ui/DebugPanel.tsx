import { useState } from 'react';
import { useGameStore, type MovementParams } from '../../store';

interface ParamDef {
  key: keyof MovementParams;
  label: string;
  min: number;
  max: number;
  step: number;
}

const PARAMS: ParamDef[] = [
  { key: 'speed', label: 'Speed', min: 1, max: 16, step: 0.5 },
  { key: 'stepHeight', label: 'Step Height', min: 0, max: 2, step: 0.1 },
  { key: 'slopeHeight', label: 'Slope Height', min: 0, max: 4, step: 0.1 },
  {
    key: 'capsuleRadius',
    label: 'Capsule Radius',
    min: 0.05,
    max: 1.5,
    step: 0.05,
  },
  {
    key: 'arrivalReach',
    label: 'Arrival Reach',
    min: 0.02,
    max: 0.5,
    step: 0.01,
  },
  { key: 'hopHeight', label: 'Hop Intensity', min: 0, max: 0.5, step: 0.01 },
  { key: 'magnetRadius', label: 'Magnet Radius', min: 0, max: 10, step: 0.5 },
  { key: 'magnetSpeed', label: 'Magnet Speed', min: 1, max: 32, step: 1 },
];

export function DebugPanel() {
  const [open, setOpen] = useState(false);
  const params = useGameStore((s) => s.characterParams);
  const setParam = useGameStore((s) => s.setCharacterParam);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        pointerEvents: 'auto',
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        fontSize: 12,
        userSelect: 'none',
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'block',
          marginLeft: 'auto',
          marginBottom: 4,
          padding: '4px 10px',
          background: 'rgba(0,0,0,0.6)',
          color: '#ccc',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 11,
        }}
      >
        {open ? 'Hide' : 'Debug'}
      </button>

      {open && (
        <div
          style={{
            background: 'rgba(0,0,0,0.7)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 6,
            padding: '8px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            minWidth: 220,
          }}
        >
          {PARAMS.map(({ key, label, min, max, step }) => (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>
                {label}
              </span>
              <input
                type='range'
                min={min}
                max={max}
                step={step}
                value={params[key] as number}
                onChange={(e) =>
                  setParam(key, parseFloat(e.target.value) as any)
                }
                style={{ flex: 1, height: 14, accentColor: '#6af' }}
              />
              <span
                style={{
                  color: '#fff',
                  width: 36,
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {(params[key] as number).toFixed(step < 0.1 ? 2 : 1)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

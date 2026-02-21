import { useState, useRef, useEffect } from 'react';
import { useGameStore, type PlayerParams, type CameraParams } from '../store';
import { Layer } from '../game/Entity';

type ActivePanel = 'player' | 'camera' | null;

interface SliderDef<K> {
  key: K;
  label: string;
  min: number;
  max: number;
  step: number;
}

const PLAYER_PARAMS: SliderDef<keyof PlayerParams>[] = [
  { key: 'speed', label: 'Speed', min: 1, max: 16, step: 0.5 },
  { key: 'stepHeight', label: 'Step Height', min: 0, max: 2, step: 0.1 },
  { key: 'capsuleRadius', label: 'Capsule Radius', min: 0.1, max: 1.5, step: 0.05 },
  { key: 'hopHeight', label: 'Hop Intensity', min: 0, max: 0.5, step: 0.01 },
  { key: 'magnetRadius', label: 'Magnet Radius', min: 0, max: 10, step: 0.5 },
  { key: 'magnetSpeed', label: 'Magnet Speed', min: 1, max: 32, step: 1 },
];

const CAMERA_PARAMS: SliderDef<keyof CameraParams>[] = [
  { key: 'minDistance', label: 'Zoom Min', min: 2, max: 15, step: 0.5 },
  { key: 'maxDistance', label: 'Zoom Max', min: 10, max: 40, step: 0.5 },
  { key: 'pitchMin', label: 'Pitch Min', min: -89, max: -20, step: 1 },
  { key: 'pitchMax', label: 'Pitch Max', min: -50, max: -5, step: 1 },
  { key: 'rotationSpeed', label: 'Rotation', min: 0.001, max: 0.02, step: 0.001 },
  { key: 'zoomSpeed', label: 'Zoom', min: 0.005, max: 0.05, step: 0.005 },
];

const btnStyle = (active: boolean) => ({
  padding: '4px 10px',
  background: active ? 'rgba(100,170,255,0.3)' : 'rgba(0,0,0,0.6)',
  color: active ? '#fff' : '#ccc',
  border: `1px solid ${active ? 'rgba(100,170,255,0.5)' : 'rgba(255,255,255,0.15)'}`,
  borderRadius: 4,
  cursor: 'pointer' as const,
  fontSize: 11,
});

const panelStyle = {
  background: 'rgba(0,0,0,0.7)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 6,
  padding: '8px 10px',
  display: 'flex' as const,
  flexDirection: 'column' as const,
  gap: 4,
  minWidth: 220,
};

const LAYER_OPTIONS: { label: string; value: number }[] = [
  { label: 'Architecture', value: Layer.Architecture },
  { label: 'Collectible', value: Layer.Collectible },
  { label: 'Character', value: Layer.Character },
  { label: 'Prop', value: Layer.Prop },
  { label: 'Light', value: Layer.Light },
  { label: 'Particle', value: Layer.Particle },
];

function CollisionLayerSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open]);

  const activeLabels = LAYER_OPTIONS.filter((o) => value & o.value).map((o) => o.label);
  const summary = activeLabels.length === 0 ? 'None' : activeLabels.join(', ');

  const toggle = (layerBit: number) => {
    onChange(value ^ layerBit);
  };

  return (
    <div ref={ref} style={{ position: 'relative', marginTop: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>Collisions</span>
        <button
          onClick={() => setOpen(!open)}
          style={{
            flex: 1,
            padding: '2px 6px',
            background: 'rgba(255,255,255,0.08)',
            color: '#ccc',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 3,
            cursor: 'pointer',
            fontSize: 11,
            textAlign: 'left',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {summary} ▾
        </button>
      </div>
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 90 + 6,
            marginBottom: 2,
            background: 'rgba(20,20,30,0.95)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 4,
            padding: '4px 0',
            zIndex: 10,
            minWidth: 130,
          }}
        >
          {LAYER_OPTIONS.map((opt) => {
            const checked = !!(value & opt.value);
            return (
              <label
                key={opt.value}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 10px',
                  cursor: 'pointer',
                  color: checked ? '#fff' : '#888',
                  fontSize: 11,
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt.value)}
                  style={{ accentColor: '#6af' }}
                />
                {opt.label}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SettingsPanel() {
  const [active, setActive] = useState<ActivePanel>(null);
  const playerParams = useGameStore((s) => s.playerParams);
  const cameraParams = useGameStore((s) => s.cameraParams);
  const setPlayerParam = useGameStore((s) => s.setPlayerParam);
  const setCameraParam = useGameStore((s) => s.setCameraParam);

  const toggle = (panel: 'player' | 'camera') =>
    setActive((cur) => (cur === panel ? null : panel));

  const decimals = (step: number) => (step < 0.01 ? 3 : step < 0.1 ? 2 : 1);

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
      {/* Slider panel */}
      {active === 'player' && (
        <div style={{ ...panelStyle, marginBottom: 4 }}>
          {PLAYER_PARAMS.map(({ key, label, min, max, step }) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>{label}</span>
              <input
                type="range"
                min={min} max={max} step={step}
                value={playerParams[key]}
                onChange={(e) => setPlayerParam(key, parseFloat(e.target.value))}
                style={{ flex: 1, height: 14, accentColor: '#6af' }}
              />
              <span style={{ color: '#fff', width: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {playerParams[key].toFixed(decimals(step))}
              </span>
            </div>
          ))}
        </div>
      )}

      {active === 'camera' && (
        <div style={{ ...panelStyle, marginBottom: 4 }}>
          {CAMERA_PARAMS.map(({ key, label, min, max, step }) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>{label}</span>
              <input
                type="range"
                min={min} max={max} step={step}
                value={cameraParams[key] as number}
                onChange={(e) => setCameraParam(key, parseFloat(e.target.value))}
                style={{ flex: 1, height: 14, accentColor: '#6af' }}
              />
              <span style={{ color: '#fff', width: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {(cameraParams[key] as number).toFixed(decimals(step))}
              </span>
            </div>
          ))}
          {/* Collision layers dropdown */}
          <CollisionLayerSelect
            value={cameraParams.collisionLayers}
            onChange={(v) => setCameraParam('collisionLayers', v)}
          />
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
        <button onClick={() => toggle('player')} style={btnStyle(active === 'player')}>
          Player
        </button>
        <button onClick={() => toggle('camera')} style={btnStyle(active === 'camera')}>
          Camera
        </button>
      </div>
    </div>
  );
}

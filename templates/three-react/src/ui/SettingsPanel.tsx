import { useState, useRef, useEffect } from 'react';
import { useGameStore, type PlayerParams, type CameraParams, type TorchParams, type LightPreset } from '../store';
import { Layer } from '../game/Entity';
import type { TerrainPreset } from '../game/Terrain';
import type { HeightmapStyle } from '../game/TerrainNoise';
import { palettes } from '../game/ColorPalettes';

type ActivePanel = 'player' | 'camera' | 'light' | 'scene' | null;

const TERRAIN_PRESETS: TerrainPreset[] = ['scattered', 'terraced', 'heightmap', 'dungeon', 'rooms'];
const HEIGHTMAP_STYLES: HeightmapStyle[] = ['rolling', 'terraces', 'islands', 'caves'];
const PALETTE_NAMES = ['random', ...Object.keys(palettes)];

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
  { key: 'slopeHeight', label: 'Slope Height', min: 0, max: 4, step: 0.1 },
  { key: 'capsuleRadius', label: 'Capsule Radius', min: 0.05, max: 1.5, step: 0.05 },
  { key: 'arrivalReach', label: 'Arrival Reach', min: 0.02, max: 0.5, step: 0.01 },
  { key: 'hopHeight', label: 'Hop Intensity', min: 0, max: 0.5, step: 0.01 },
  { key: 'magnetRadius', label: 'Magnet Radius', min: 0, max: 10, step: 0.5 },
  { key: 'magnetSpeed', label: 'Magnet Speed', min: 1, max: 32, step: 1 },
];

const TORCH_PARAMS: SliderDef<keyof TorchParams>[] = [
  { key: 'intensity', label: 'Intensity', min: 0, max: 8, step: 0.1 },
  { key: 'distance', label: 'Distance', min: 1, max: 20, step: 0.5 },
  { key: 'offsetForward', label: 'Fwd Offset', min: -1, max: 2, step: 0.05 },
  { key: 'offsetRight', label: 'Right Offset', min: -1, max: 1, step: 0.05 },
  { key: 'offsetUp', label: 'Up Offset', min: 0.1, max: 5, step: 0.1 },
  { key: 'flicker', label: 'Flicker', min: 0, max: 1, step: 0.05 },
];

const LIGHT_PRESETS: LightPreset[] = ['default', 'bright', 'dark', 'none'];

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

const resetBtnStyle = {
  marginTop: 4,
  padding: '4px 12px',
  background: 'rgba(255,100,100,0.15)',
  color: '#f88',
  border: '1px solid rgba(255,100,100,0.3)',
  borderRadius: 4,
  cursor: 'pointer' as const,
  fontSize: 11,
  fontWeight: 600,
  width: '100%',
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

function ScenePanel() {
  const terrainPreset = useGameStore((s) => s.terrainPreset);
  const heightmapStyle = useGameStore((s) => s.heightmapStyle);
  const setTerrainPreset = useGameStore((s) => s.setTerrainPreset);
  const setHeightmapStyle = useGameStore((s) => s.setHeightmapStyle);
  const regenerate = useGameStore((s) => s.onRegenerateScene);
  const heightmapThumb = useGameStore((s) => s.heightmapThumb);
  const paletteName = useGameStore((s) => s.paletteName);
  const paletteActive = useGameStore((s) => s.paletteActive);
  const setPaletteName = useGameStore((s) => s.setPaletteName);
  const gridOpacity = useGameStore((s) => s.gridOpacity);
  const setGridOpacity = useGameStore((s) => s.setGridOpacity);
  const wallGap = useGameStore((s) => s.wallGap);
  const setWallGap = useGameStore((s) => s.setWallGap);
  const resolutionScale = useGameStore((s) => s.resolutionScale);
  const setResolutionScale = useGameStore((s) => s.setResolutionScale);
  const remesh = useGameStore((s) => s.onRemesh);
  const randomizePalette = useGameStore((s) => s.onRandomizePalette);

  return (
    <div style={{ ...panelStyle, marginBottom: 4 }}>
      {/* Heightmap thumbnail + label row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {heightmapThumb && (
          <img
            src={heightmapThumb}
            alt="heightmap"
            style={{
              width: 48,
              height: 48,
              imageRendering: 'pixelated',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 3,
              flexShrink: 0,
            }}
          />
        )}
        <div style={{ color: '#6af', fontSize: 10, fontWeight: 700, letterSpacing: 1.5 }}>TERRAIN</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>Preset</span>
        <div style={{ display: 'flex', gap: 3, flex: 1 }}>
          {TERRAIN_PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setTerrainPreset(p)}
              style={{
                ...btnStyle(terrainPreset === p),
                flex: 1,
                textTransform: 'capitalize',
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Heightmap style — only when heightmap preset */}
      {terrainPreset === 'heightmap' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>Style</span>
          <div style={{ display: 'flex', gap: 3, flex: 1 }}>
            {HEIGHTMAP_STYLES.map((s) => (
              <button
                key={s}
                onClick={() => setHeightmapStyle(s)}
                style={{
                  ...btnStyle(heightmapStyle === s),
                  flex: 1,
                  textTransform: 'capitalize',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Wall gap slider — only when rooms preset */}
      {terrainPreset === 'rooms' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>Wall Gap</span>
          <input
            type="range"
            min={0} max={4} step={1}
            value={wallGap}
            onChange={(e) => setWallGap(parseInt(e.target.value, 10))}
            style={{ flex: 1, height: 14, accentColor: '#6af' }}
          />
          <span style={{ color: '#fff', width: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {wallGap}
          </span>
        </div>
      )}

      {/* Palette dropdown */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>Palette</span>
        <select
          value={paletteName}
          onChange={(e) => setPaletteName(e.target.value)}
          style={{
            flex: 1,
            padding: '3px 6px',
            background: 'rgba(255,255,255,0.08)',
            color: '#ccc',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 3,
            fontSize: 11,
            cursor: 'pointer',
            textTransform: 'capitalize',
          }}
        >
          {PALETTE_NAMES.map((name) => (
            <option key={name} value={name} style={{ background: '#1a1a2a', color: '#ccc' }}>
              {name}
            </option>
          ))}
        </select>
        {paletteActive && (
          <span
            onClick={() => randomizePalette?.()}
            style={{
              color: '#6af',
              fontSize: 10,
              flexShrink: 0,
              textTransform: 'capitalize',
              cursor: 'pointer',
              padding: '2px 4px',
              borderRadius: 3,
              background: 'rgba(100,170,255,0.1)',
            }}
            title="Click to randomize palette"
          >
            {paletteActive}
          </span>
        )}
      </div>

      {/* Grid opacity slider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>Grid</span>
        <input
          type="range"
          min={0} max={1} step={0.05}
          value={gridOpacity}
          onChange={(e) => setGridOpacity(parseFloat(e.target.value))}
          style={{ flex: 1, height: 14, accentColor: '#6af' }}
        />
        <span style={{ color: '#fff', width: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {gridOpacity.toFixed(2)}
        </span>
      </div>

      {/* Resolution scale slider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>Resolution</span>
        <input
          type="range"
          min={0.5} max={3} step={0.5}
          value={resolutionScale}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setResolutionScale(v);
            // Debounce remesh: wait until user stops dragging
            clearTimeout((window as any).__remeshTimer);
            (window as any).__remeshTimer = setTimeout(() => remesh?.(), 300);
          }}
          style={{ flex: 1, height: 14, accentColor: '#6af' }}
        />
        <span style={{ color: '#fff', width: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {resolutionScale.toFixed(1)}×
        </span>
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <button onClick={() => useGameStore.getState().onResetSceneParams?.()} style={{ ...resetBtnStyle, marginTop: 0, flex: 1 }}>
          Reset
        </button>
        <button
          onClick={() => regenerate?.()}
          style={{
            flex: 1,
            padding: '4px 12px',
            background: 'rgba(100,220,120,0.2)',
            color: '#8f8',
            border: '1px solid rgba(100,220,120,0.4)',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          Regenerate
        </button>
      </div>
    </div>
  );
}

export function SettingsPanel() {
  const [active, setActive] = useState<ActivePanel>(null);
  const playerParams = useGameStore((s) => s.playerParams);
  const cameraParams = useGameStore((s) => s.cameraParams);
  const torchParams = useGameStore((s) => s.torchParams);
  const torchEnabled = useGameStore((s) => s.torchEnabled);
  const lightPreset = useGameStore((s) => s.lightPreset);
  const setPlayerParam = useGameStore((s) => s.setPlayerParam);
  const setCameraParam = useGameStore((s) => s.setCameraParam);
  const setTorchParam = useGameStore((s) => s.setTorchParam);
  const toggleTorch = useGameStore((s) => s.toggleTorch);
  const setLightPreset = useGameStore((s) => s.setLightPreset);

  const toggle = (panel: ActivePanel) =>
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
          <button onClick={() => useGameStore.getState().onResetPlayerParams?.()} style={resetBtnStyle}>
            Reset Defaults
          </button>
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
          <button onClick={() => useGameStore.getState().onResetCameraParams?.()} style={resetBtnStyle}>
            Reset Defaults
          </button>
        </div>
      )}

      {active === 'light' && (
        <div style={{ ...panelStyle, marginBottom: 4 }}>
          {/* ── Scene ── */}
          <div style={{ color: '#6af', fontSize: 10, fontWeight: 700, letterSpacing: 1.5, marginBottom: 2 }}>SCENE</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>Preset</span>
            <div style={{ display: 'flex', gap: 3, flex: 1 }}>
              {LIGHT_PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setLightPreset(p)}
                  style={{
                    ...btnStyle(lightPreset === p),
                    flex: 1,
                    textTransform: 'capitalize',
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* ── Torch ── */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 6, marginTop: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: '#fa4', fontSize: 10, fontWeight: 700, letterSpacing: 1.5 }}>TORCH</span>
              <button
                onClick={toggleTorch}
                style={{
                  ...btnStyle(torchEnabled),
                  fontSize: 10,
                  padding: '2px 8px',
                  background: torchEnabled ? 'rgba(255,170,68,0.25)' : 'rgba(0,0,0,0.4)',
                  borderColor: torchEnabled ? 'rgba(255,170,68,0.5)' : 'rgba(255,255,255,0.15)',
                  color: torchEnabled ? '#fa4' : '#666',
                }}
              >
                {torchEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
            {torchEnabled && (<>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>Color</span>
                <input
                  type="color"
                  value={torchParams.color}
                  onChange={(e) => setTorchParam('color', e.target.value)}
                  style={{ width: 32, height: 20, border: 'none', background: 'none', cursor: 'pointer' }}
                />
                <span style={{ color: '#fff', fontSize: 11 }}>{torchParams.color}</span>
              </div>
              {TORCH_PARAMS.map(({ key, label, min, max, step }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>{label}</span>
                  <input
                    type="range"
                    min={min} max={max} step={step}
                    value={torchParams[key] as number}
                    onChange={(e) => setTorchParam(key, parseFloat(e.target.value))}
                    style={{ flex: 1, height: 14, accentColor: '#fa4' }}
                  />
                  <span style={{ color: '#fff', width: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {(torchParams[key] as number).toFixed(step < 0.1 ? 2 : 1)}
                  </span>
                </div>
              ))}
            </>)}
          </div>
          <button onClick={() => useGameStore.getState().onResetLightParams?.()} style={resetBtnStyle}>
            Reset Defaults
          </button>
        </div>
      )}

      {active === 'scene' && <ScenePanel />}

      {/* Buttons */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
        <button onClick={() => toggle('scene')} style={btnStyle(active === 'scene')}>
          Scene
        </button>
        <button onClick={() => toggle('player')} style={btnStyle(active === 'player')}>
          Player
        </button>
        <button onClick={() => toggle('camera')} style={btnStyle(active === 'camera')}>
          Camera
        </button>
        <button onClick={() => toggle('light')} style={btnStyle(active === 'light')}>
          Light
        </button>
      </div>
    </div>
  );
}

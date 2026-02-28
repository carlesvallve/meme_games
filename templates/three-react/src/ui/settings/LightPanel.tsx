import { useGameStore, type TorchParams, type LightPreset } from '../../store';
import { SettingsWindow, Section, Slider, Toggle, type SliderDef, btnStyle, resetBtnStyle, rowStyle } from './shared';

const TORCH_PARAMS: SliderDef<keyof TorchParams>[] = [
  { key: 'intensity', label: 'Intensity', min: 0, max: 8, step: 0.1 },
  { key: 'distance', label: 'Distance', min: 1, max: 20, step: 0.5 },
  { key: 'offsetForward', label: 'Fwd Offset', min: -1, max: 2, step: 0.05 },
  { key: 'offsetRight', label: 'Right Offset', min: -1, max: 1, step: 0.05 },
  { key: 'offsetUp', label: 'Up Offset', min: 0.1, max: 5, step: 0.1 },
  { key: 'flicker', label: 'Flicker', min: 0, max: 1, step: 0.05 },
];

const LIGHT_PRESETS: LightPreset[] = ['default', 'bright', 'dark', 'none'];

export function LightPanel() {
  const torchParams = useGameStore((s) => s.torchParams);
  const torchEnabled = useGameStore((s) => s.torchEnabled);
  const lightPreset = useGameStore((s) => s.lightPreset);
  const setTorchParam = useGameStore((s) => s.setTorchParam);
  const toggleTorch = useGameStore((s) => s.toggleTorch);
  const setLightPreset = useGameStore((s) => s.setLightPreset);

  return (
    <SettingsWindow>
      <Section label="Light" first>
        <div style={rowStyle}>
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
      </Section>

      <Section label="Torch" accent="#fa4">
        <Toggle label="Enabled" value={torchEnabled} onChange={() => toggleTorch()} />
        {torchEnabled && (<>
          <div style={rowStyle}>
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
            <Slider key={key} label={label} value={torchParams[key] as number} min={min} max={max} step={step}
              accent="#fa4" onChange={(v) => setTorchParam(key, v)} />
          ))}
        </>)}
      </Section>

      <button onClick={() => useGameStore.getState().onResetLightParams?.()} style={resetBtnStyle}>
        Reset Defaults
      </button>
    </SettingsWindow>
  );
}

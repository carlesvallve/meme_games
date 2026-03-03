import {
  useGameStore,
  type TorchParams,
  type LightPreset,
} from '../../../store';
import {
  SettingsWindow,
  Section,
  Slider,
  Toggle,
  type SliderDef,
  btnStyle,
  resetBtnStyle,
  rowStyle,
} from './shared';

const TORCH_PARAMS: SliderDef<keyof TorchParams>[] = [
  { key: 'intensity', label: 'Intensity', min: 0, max: 8, step: 0.1 },
  { key: 'distance', label: 'Distance', min: 1, max: 20, step: 0.5 },
  { key: 'offsetForward', label: 'Fwd Offset', min: -1, max: 2, step: 0.05 },
  { key: 'offsetRight', label: 'Right Offset', min: -1, max: 1, step: 0.05 },
  { key: 'offsetUp', label: 'Up Offset', min: 0.1, max: 5, step: 0.1 },
  { key: 'flicker', label: 'Flicker', min: 0, max: 1, step: 0.05 },
];

const LIGHT_PRESETS: LightPreset[] = ['default', 'bright', 'dark', 'none'];

function formatTime(h: number): string {
  const hours = Math.floor(h) % 24;
  const minutes = Math.round((h % 1) * 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

export function LightPanel() {
  const torchParams = useGameStore((s) => s.torchParams);
  const torchEnabled = useGameStore((s) => s.torchEnabled);
  const lightPreset = useGameStore((s) => s.lightPreset);
  const setTorchParam = useGameStore((s) => s.setTorchParam);
  const toggleTorch = useGameStore((s) => s.toggleTorch);
  const setLightPreset = useGameStore((s) => s.setLightPreset);
  const timeOfDay = useGameStore((s) => s.timeOfDay);
  const setTimeOfDay = useGameStore((s) => s.setTimeOfDay);
  const dayCycleEnabled = useGameStore((s) => s.dayCycleEnabled);
  const setDayCycleEnabled = useGameStore((s) => s.setDayCycleEnabled);
  const dayCycleSpeed = useGameStore((s) => s.dayCycleSpeed);
  const setDayCycleSpeed = useGameStore((s) => s.setDayCycleSpeed);
  const fastNights = useGameStore((s) => s.fastNights);
  const setFastNights = useGameStore((s) => s.setFastNights);
  const sunDebug = useGameStore((s) => s.sunDebug);
  const setSunDebug = useGameStore((s) => s.setSunDebug);

  return (
    <SettingsWindow>
      <Section label='Light' first>
        <div style={rowStyle}>
          <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>
            Preset
          </span>
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

      <Section label='Day Cycle' accent='#8cf'>
        <Slider
          label={formatTime(timeOfDay)}
          value={timeOfDay}
          min={0}
          max={24}
          step={0.25}
          accent='#8cf'
          onChange={(v) => setTimeOfDay(v % 24)}
        />
        <Toggle
          label='Auto Cycle'
          value={dayCycleEnabled}
          onChange={setDayCycleEnabled}
        />
        {dayCycleEnabled && (
          <Slider
            label='Speed'
            value={dayCycleSpeed}
            min={0.1}
            max={10}
            step={0.1}
            accent='#8cf'
            onChange={setDayCycleSpeed}
          />
        )}
        <Toggle
          label='Fast Nights'
          value={fastNights}
          onChange={setFastNights}
        />
        <Toggle
          label='Sun Debug'
          value={sunDebug}
          onChange={setSunDebug}
        />
      </Section>

      <Section label='Torch' accent='#fa4'>
        <Toggle
          label='Enabled'
          value={torchEnabled}
          onChange={() => toggleTorch()}
        />
        {torchEnabled && (
          <>
            <div style={rowStyle}>
              <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>
                Color
              </span>
              <input
                type='color'
                value={torchParams.color}
                onChange={(e) => setTorchParam('color', e.target.value)}
                style={{
                  width: 32,
                  height: 20,
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                }}
              />
              <span style={{ color: '#fff', fontSize: 11 }}>
                {torchParams.color}
              </span>
            </div>
            {TORCH_PARAMS.map(({ key, label, min, max, step }) => (
              <Slider
                key={key}
                label={label}
                value={torchParams[key] as number}
                min={min}
                max={max}
                step={step}
                accent='#fa4'
                onChange={(v) => setTorchParam(key, v)}
              />
            ))}
          </>
        )}
      </Section>

      <button
        onClick={() => useGameStore.getState().onResetLightParams?.()}
        style={resetBtnStyle}
      >
        Reset Defaults
      </button>
    </SettingsWindow>
  );
}

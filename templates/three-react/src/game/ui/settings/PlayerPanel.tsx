import {
  useGameStore,
  type MovementParams,
  type MovementMode,
} from '../../../store';
import {
  SettingsWindow,
  Section,
  Slider,
  Toggle,
  type SliderDef,
  resetBtnStyle,
  rowStyle,
} from './shared';

const CHARACTER_MOVE_PARAMS: SliderDef<keyof MovementParams>[] = [
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
  { key: 'magnetRadius', label: 'Magnet Radius', min: 0, max: 10, step: 0.1 },
  { key: 'magnetSpeed', label: 'Magnet Speed', min: 1, max: 32, step: 1 },
];

export function PlayerPanel() {
  const characterParams = useGameStore((s) => s.characterParams);
  const setCharacterParam = useGameStore((s) => s.setCharacterParam);
  const setMeleeParam = useGameStore((s) => s.setMeleeParam);
  const setRangedParam = useGameStore((s) => s.setRangedParam);
  const characterPushEnabled = useGameStore((s) => s.characterPushEnabled);
  const setCharacterPushEnabled = useGameStore(
    (s) => s.setCharacterPushEnabled,
  );
  const debugProjectileStick = useGameStore((s) => s.debugProjectileStick);
  const setDebugProjectileStick = useGameStore(
    (s) => s.setDebugProjectileStick,
  );

  return (
    <SettingsWindow>
      <Section label='Move' first>
        <div style={rowStyle}>
          <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>
            Movement
          </span>
          {(['free', 'grid'] as MovementMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setCharacterParam('movementMode', mode)}
              style={{
                ...resetBtnStyle,
                flex: 1,
                background:
                  characterParams.movementMode === mode ? '#6af' : '#333',
                color: characterParams.movementMode === mode ? '#000' : '#aaa',
                margin: 0,
              }}
            >
              {mode}
            </button>
          ))}
        </div>
        <Toggle
          label='Path Debug'
          value={characterParams.showPathDebug}
          onChange={(v) => setCharacterParam('showPathDebug', v)}
        />
        <Toggle
          label='Character push'
          value={characterPushEnabled}
          onChange={setCharacterPushEnabled}
        />
        <Toggle
          label='Foot IK'
          value={characterParams.footIKEnabled}
          onChange={(v) => setCharacterParam('footIKEnabled', v)}
        />
        {CHARACTER_MOVE_PARAMS.map(({ key, label, min, max, step }) => (
          <Slider
            key={key}
            label={label}
            value={characterParams[key] as number}
            min={min}
            max={max}
            step={step}
            onChange={(v) => setCharacterParam(key, v as any)}
          />
        ))}
      </Section>

      <Section label='Defense'>
        <Slider
          label='Invuln'
          value={characterParams.invulnDuration}
          min={0}
          max={2}
          step={0.05}
          onChange={(v) => setCharacterParam('invulnDuration', v)}
        />
        <Slider
          label='Stun'
          value={characterParams.stunDuration}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => setCharacterParam('stunDuration', v)}
        />
      </Section>

      <Section label='Melee'>
        <Toggle
          label='Auto-target'
          value={characterParams.melee.autoTarget}
          onChange={(v) => setMeleeParam('autoTarget', v)}
        />
        <Slider
          label='Knockback'
          value={characterParams.melee.knockback}
          min={0}
          max={15}
          step={0.5}
          onChange={(v) => setMeleeParam('knockback', v)}
        />
        <Toggle
          label='Slash effect'
          value={characterParams.melee.showSlashEffect}
          onChange={(v) => setMeleeParam('showSlashEffect', v)}
        />
        <Toggle
          label='Hitstop'
          value={characterParams.melee.hitstopEnabled}
          onChange={(v) => setMeleeParam('hitstopEnabled', v)}
        />
      </Section>

      <Section label='Ranged'>
        <Toggle
          label='Auto-target'
          value={characterParams.ranged.autoTarget}
          onChange={(v) => setRangedParam('autoTarget', v)}
        />
        <Slider
          label='Knockback'
          value={characterParams.ranged.knockback}
          min={0}
          max={15}
          step={0.5}
          onChange={(v) => setRangedParam('knockback', v)}
        />
        <Toggle
          label='Debug'
          value={debugProjectileStick}
          onChange={setDebugProjectileStick}
        />
      </Section>

      <button
        onClick={() => useGameStore.getState().onResetCharacterParams?.()}
        style={resetBtnStyle}
      >
        Reset Defaults
      </button>
    </SettingsWindow>
  );
}

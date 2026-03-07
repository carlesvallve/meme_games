import { useGameStore } from '../../../store';
import { SettingsWindow, Section, Select, Slider, Toggle, btnStyle, rowStyle, resetBtnStyle } from './shared';

const SNAP_MODES = ['free', '4dir', '8dir'] as const;

export function CharacterPanel() {
  const animList = useGameStore((s) => s.charAnimationList);
  const animation = useGameStore((s) => s.charAnimation);
  const speed = useGameStore((s) => s.charSpeed);
  const moveSpeed = useGameStore((s) => s.charMoveSpeed);
  const hop = useGameStore((s) => s.charHop);
  const stepHeight = useGameStore((s) => s.charStepHeight);
  const setStepHeight = useGameStore((s) => s.setCharStepHeight);
  const debugPath = useGameStore((s) => s.charDebugPath);
  const stringPull = useGameStore((s) => s.charStringPull);
  const snapMode = useGameStore((s) => s.charSnapMode);
  const autoMove = useGameStore((s) => s.charAutoMove);
  const setAutoMove = useGameStore((s) => s.setCharAutoMove);
  const continuousPath = useGameStore((s) => s.charContinuousPath);
  const setContinuousPath = useGameStore((s) => s.setCharContinuousPath);
  const setAnimation = useGameStore((s) => s.setCharAnimation);
  const setSpeed = useGameStore((s) => s.setCharSpeed);
  const setMoveSpeed = useGameStore((s) => s.setCharMoveSpeed);
  const setHop = useGameStore((s) => s.setCharHop);
  const setDebugPath = useGameStore((s) => s.setCharDebugPath);
  const setStringPull = useGameStore((s) => s.setCharStringPull);
  const setSnapMode = useGameStore((s) => s.setCharSnapMode);

  return (
    <SettingsWindow>
      <Section label='Animation' first accent='#af6'>
        {animList.length > 0 ? (
          <Select
            label='Clip'
            value={animation}
            options={animList}
            accent='#af6'
            onChange={setAnimation}
          />
        ) : (
          <div style={{ color: '#888', fontSize: 11 }}>Loading model...</div>
        )}
        <Slider
          label='Anim Speed'
          value={speed}
          min={0}
          max={10}
          step={0.1}
          accent='#af6'
          onChange={setSpeed}
        />
        <Slider
          label='Move Speed'
          value={moveSpeed}
          min={1}
          max={15}
          step={0.5}
          accent='#af6'
          onChange={setMoveSpeed}
        />
        <Slider
          label='Step Height'
          value={stepHeight}
          min={0}
          max={1.5}
          step={0.05}
          accent='#af6'
          onChange={setStepHeight}
        />
        <Toggle
          label='Hop'
          value={hop}
          onChange={setHop}
        />
        <Toggle
          label='Debug Path'
          value={debugPath}
          onChange={setDebugPath}
        />
        <Toggle
          label='String Pull'
          value={stringPull}
          onChange={setStringPull}
        />
        <Toggle
          label='Auto Move'
          value={autoMove}
          onChange={setAutoMove}
        />
        <Toggle
          label='Continuous Path'
          value={continuousPath}
          onChange={setContinuousPath}
        />
        <div style={rowStyle}>
          <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>
            Movement
          </span>
          <div style={{ display: 'flex', gap: 3, flex: 1 }}>
            {SNAP_MODES.map((m) => (
              <button
                key={m}
                onClick={() => setSnapMode(m)}
                style={{
                  ...btnStyle(snapMode === m),
                  flex: 1,
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </Section>
      <button
        onClick={() => useGameStore.setState({
          charAnimation: 'Idle',
          charSpeed: 1,
          charMoveSpeed: 5,
          charStepHeight: 0.5,
          charHop: true,
          charDebugPath: false,
          charStringPull: true,
          charAutoMove: true,
          charContinuousPath: true,
          charSnapMode: '8dir' as 'free' | '4dir' | '8dir',
        })}
        style={resetBtnStyle}
      >
        Reset Defaults
      </button>
    </SettingsWindow>
  );
}

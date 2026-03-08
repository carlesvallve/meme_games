import { useMemo } from 'react';
import { useGameStore } from '../../../store';
import { SettingsWindow, Section, Select, Slider, Toggle, btnStyle, rowStyle, resetBtnStyle } from './shared';
import { CHARACTER_MODELS } from '../../CharacterModelDefs';

const SNAP_MODES = ['free', '4dir', '8dir'] as const;
const MODEL_OPTIONS = CHARACTER_MODELS.map((m) => m.id);
const MODEL_LABELS = CHARACTER_MODELS.map((m) => m.label);

export function CharacterPanel() {
  const charModel = useGameStore((s) => s.charModel);
  const setCharModel = useGameStore((s) => s.setCharModel);
  const animList = useGameStore((s) => s.charAnimationList);
  const animGroup = useGameStore((s) => s.charAnimGroup);
  const setAnimGroup = useGameStore((s) => s.setCharAnimGroup);
  const animation = useGameStore((s) => s.charAnimation);
  const speed = useGameStore((s) => s.charSpeed);
  const moveSpeed = useGameStore((s) => s.charMoveSpeed);
  const hop = useGameStore((s) => s.charHop);
  const stepUp = useGameStore((s) => s.charStepUp);
  const setStepUp = useGameStore((s) => s.setCharStepUp);
  const stepDown = useGameStore((s) => s.charStepDown);
  const setStepDown = useGameStore((s) => s.setCharStepDown);
  const rotSpeed = useGameStore((s) => s.charRotSpeed);
  const setRotSpeed = useGameStore((s) => s.setCharRotSpeed);
  const gravity = useGameStore((s) => s.charGravity);
  const setGravity = useGameStore((s) => s.setCharGravity);
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

  // Parse animation groups from "Group/AnimName" format
  const { groups, animsForGroup } = useMemo(() => {
    const groupSet = new Set<string>();
    const map = new Map<string, string[]>();
    for (const name of animList) {
      const slashIdx = name.indexOf('/');
      if (slashIdx > 0) {
        const g = name.slice(0, slashIdx);
        groupSet.add(g);
        if (!map.has(g)) map.set(g, []);
        map.get(g)!.push(name);
      } else {
        // Ungrouped animations go under "Other"
        groupSet.add('Other');
        if (!map.has('Other')) map.set('Other', []);
        map.get('Other')!.push(name);
      }
    }
    return { groups: Array.from(groupSet), animsForGroup: map };
  }, [animList]);

  // Auto-select first group if current group is invalid
  const effectiveGroup = groups.includes(animGroup) ? animGroup : (groups[0] ?? '');

  // Animations in the selected group
  const currentAnims = animsForGroup.get(effectiveGroup) ?? [];
  // Display labels: strip group prefix
  const animLabels = currentAnims.map((a) => {
    const slashIdx = a.indexOf('/');
    return slashIdx > 0 ? a.slice(slashIdx + 1) : a;
  });

  const handleGroupChange = (g: string) => {
    setAnimGroup(g);
    // Auto-select first animation in the new group
    const anims = animsForGroup.get(g);
    if (anims && anims.length > 0) {
      setAnimation(anims[0]);
    }
  };

  return (
    <SettingsWindow>
      <Section label='Model' first accent='#f8a'>
        <Select
          label='Model'
          value={charModel}
          options={MODEL_OPTIONS}
          labels={MODEL_LABELS}
          accent='#f8a'
          onChange={setCharModel}
        />
        {animList.length > 0 ? (
          <>
            {groups.length > 1 && (
              <Select
                label='Anim Set'
                value={effectiveGroup}
                options={groups}
                accent='#f8a'
                onChange={handleGroupChange}
              />
            )}
            <Select
              label='Animation'
              value={animation}
              options={currentAnims}
              labels={animLabels}
              accent='#f8a'
              onChange={setAnimation}
            />
          </>
        ) : (
          charModel !== 'none' && <div style={{ color: '#888', fontSize: 11 }}>Loading model...</div>
        )}
        {animList.length > 0 && (
          <Slider
            label='Anim Speed'
            value={speed}
            min={0}
            max={3}
            step={0.1}
            accent='#f8a'
            onChange={setSpeed}
          />
        )}
      </Section>
      <Section label='Movement' accent='#af6'>
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
          label='Step Up'
          value={stepUp}
          min={0}
          max={1.5}
          step={0.05}
          accent='#af6'
          onChange={setStepUp}
        />
        <Slider
          label='Step Down'
          value={stepDown}
          min={0}
          max={3}
          step={0.05}
          accent='#af6'
          onChange={setStepDown}
        />
        <Slider
          label='Rot Speed'
          value={rotSpeed}
          min={1}
          max={50}
          step={1}
          accent='#af6'
          onChange={setRotSpeed}
        />
        <Slider
          label='Gravity'
          value={gravity}
          min={10}
          max={200}
          step={5}
          accent='#af6'
          onChange={setGravity}
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
          charStepUp: 0.5,
          charStepDown: 1.0,
          charRotSpeed: 12,
          charGravity: 60,
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

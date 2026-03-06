import { useGameStore } from '../../../store';
import { SettingsWindow, Section, Select, Slider, Toggle } from './shared';

export function CharacterPanel() {
  const animList = useGameStore((s) => s.charAnimationList);
  const animation = useGameStore((s) => s.charAnimation);
  const speed = useGameStore((s) => s.charSpeed);
  const moveSpeed = useGameStore((s) => s.charMoveSpeed);
  const hop = useGameStore((s) => s.charHop);
  const setAnimation = useGameStore((s) => s.setCharAnimation);
  const setSpeed = useGameStore((s) => s.setCharSpeed);
  const setMoveSpeed = useGameStore((s) => s.setCharMoveSpeed);
  const setHop = useGameStore((s) => s.setCharHop);

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
        <Toggle
          label='Hop'
          value={hop}
          onChange={setHop}
        />
      </Section>
    </SettingsWindow>
  );
}

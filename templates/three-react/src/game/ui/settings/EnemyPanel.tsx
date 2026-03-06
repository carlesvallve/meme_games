import { useMemo } from 'react';
import { useGameStore, type EnemyParams } from '../../../store';
import {
  SettingsWindow,
  Section,
  Slider,
  Toggle,
  RangeSlider,
  MultiSelect,
  resetBtnStyle,
  rowStyle,
  selectStyle,
} from './shared';
import { getEnemyTypeGroups } from '../../character/VoxCharacterDB';
import { getRecipeNames, getRecipe } from '../../dungeon';

const accent = '#f66';

export function EnemyPanel() {
  const ep = useGameStore((s) => s.enemyParams);
  const set = useGameStore((s) => s.setEnemyParam);
  const setMelee = useGameStore((s) => s.setEnemyMeleeParam);
  const setRanged = useGameStore((s) => s.setEnemyRangedParam);

  const enemyTypeOptions = useMemo(() => {
    return getEnemyTypeGroups().map((g) => ({
      label: g.label,
      value: g.ids.join(','),
    }));
  }, []);

  const recipeNames = useMemo(() => getRecipeNames(), []);
  const progressionRecipe = useGameStore((s) => s.progressionRecipe);
  const setProgressionRecipe = useGameStore((s) => s.setProgressionRecipe);

  const enemiesEnabled = useGameStore((s) => s.enemiesEnabled);
  const setEnemiesEnabled = useGameStore((s) => s.setEnemiesEnabled);

  return (
    <SettingsWindow>
      <Section label='Enemies' accent={accent} first>
        <Toggle
          label='Enabled'
          value={enemiesEnabled}
          onChange={setEnemiesEnabled}
        />
      </Section>

      <Section label='Progression' accent={accent}>
        <div style={rowStyle}>
          <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>
            Recipe
          </span>
          <select
            value={progressionRecipe}
            onChange={(e) => setProgressionRecipe(e.target.value)}
            style={selectStyle}
          >
            {recipeNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div
          style={{
            fontSize: 10,
            color: '#888',
            marginTop: 2,
            lineHeight: '14px',
          }}
        >
          {getRecipe(progressionRecipe)?.description ?? ''}
        </div>
      </Section>

      <Section label='Difficulty' accent={accent}>
        <Slider
          label='Difficulty'
          value={ep.difficulty}
          min={0}
          max={2}
          step={0.1}
          accent={accent}
          onChange={(v) => set('difficulty', v)}
        />
      </Section>

      <Section label='Spawn' accent={accent}>
        <Slider
          label='Enemy Density'
          value={ep.enemyDensity}
          min={0}
          max={0.08}
          step={0.005}
          accent={accent}
          onChange={(v) => set('enemyDensity', v)}
        />
        <Slider
          label='Respawn Time'
          value={ep.spawnInterval}
          min={0}
          max={60}
          step={1}
          accent={accent}
          onChange={(v) => set('spawnInterval', v)}
        />
        <MultiSelect
          label='Types'
          options={enemyTypeOptions}
          selected={
            ep.allowedTypes.length === 0
              ? []
              : enemyTypeOptions
                  .filter((o) => {
                    const ids = o.value.split(',');
                    return ids.some((id) => ep.allowedTypes.includes(id));
                  })
                  .map((o) => o.value)
          }
          allLabel='All Types'
          accent={accent}
          onChange={(sel) => {
            // Flatten selected group values (comma-separated ids) into a flat array
            const ids = sel.flatMap((v) => v.split(','));
            set('allowedTypes', ids);
          }}
        />
      </Section>

      <Section label='Behaviour' accent={accent}>
        <Slider
          label='HP'
          value={ep.hp}
          min={1}
          max={20}
          step={1}
          accent={accent}
          onChange={(v) => set('hp', v)}
        />
        <Slider
          label='Player Dmg'
          value={ep.playerDamage}
          min={1}
          max={10}
          step={1}
          accent={accent}
          onChange={(v) => set('playerDamage', v)}
        />
        <Slider
          label='Chase Range (cells)'
          value={ep.chaseRange}
          min={0}
          max={60}
          step={1}
          accent={accent}
          onChange={(v) => set('chaseRange', v)}
        />
      </Section>

      <Section label='Move' accent={accent}>
        <RangeSlider
          label='Speed'
          value={ep.speed}
          min={0.2}
          max={6}
          step={0.1}
          accent={accent}
          onChange={(v) => set('speed', v)}
        />
      </Section>

      <Section label='Defense' accent={accent}>
        <Slider
          label='Invuln'
          value={ep.invulnDuration}
          min={0}
          max={2}
          step={0.05}
          accent={accent}
          onChange={(v) => set('invulnDuration', v)}
        />
        <Slider
          label='Stun'
          value={ep.stunDuration}
          min={0}
          max={1}
          step={0.05}
          accent={accent}
          onChange={(v) => set('stunDuration', v)}
        />
      </Section>

      <Section label='Regen' accent={accent}>
        <Slider
          label='Delay'
          value={ep.regenDelay}
          min={0}
          max={10}
          step={0.5}
          accent={accent}
          onChange={(v) => set('regenDelay', v)}
        />
        <Slider
          label='Rate (HP/s)'
          value={ep.regenRate}
          min={0}
          max={2}
          step={0.05}
          accent={accent}
          onChange={(v) => set('regenRate', v)}
        />
      </Section>

      <Section label='Melee' accent={accent}>
        <Slider
          label='Damage'
          value={ep.attackDamage}
          min={1}
          max={10}
          step={1}
          accent={accent}
          onChange={(v) => set('attackDamage', v)}
        />
        <Slider
          label='Knockback'
          value={ep.melee.knockback}
          min={0}
          max={15}
          step={0.5}
          accent={accent}
          onChange={(v) => setMelee('knockback', v)}
        />
        <Slider
          label='Cooldown'
          value={ep.attackCooldown}
          min={0.2}
          max={5}
          step={0.1}
          accent={accent}
          onChange={(v) => set('attackCooldown', v)}
        />
        <Toggle
          label='Slash effect'
          value={ep.melee.showSlashEffect}
          onChange={(v) => setMelee('showSlashEffect', v)}
        />
      </Section>

      <Section label='Ranged' accent={accent}>
        <Toggle
          label='Enabled'
          value={ep.ranged.enabled}
          onChange={(v) => setRanged('enabled', v)}
        />
        {ep.ranged.enabled && (
          <Slider
            label='Knockback'
            value={ep.ranged.knockback}
            min={0}
            max={15}
            step={0.5}
            accent={accent}
            onChange={(v) => setRanged('knockback', v)}
          />
        )}
      </Section>

      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <button
          onClick={() => useGameStore.getState().onResetEnemyParams?.()}
          style={{ ...resetBtnStyle, flex: 1 }}
        >
          Reset Defaults
        </button>
        <button
          onClick={() => useGameStore.getState().onSpawnEnemy?.()}
          style={{
            ...resetBtnStyle,
            flex: 1,
            background: 'rgba(100,200,255,0.15)',
            color: '#6cf',
            border: '1px solid rgba(100,200,255,0.3)',
          }}
        >
          Spawn Enemy
        </button>
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <button
          onClick={() => useGameStore.getState().onTestFrenzyDrink?.()}
          style={{
            ...resetBtnStyle,
            flex: 1,
            background: 'rgba(255,80,80,0.15)',
            color: '#f66',
            border: '1px solid rgba(255,80,80,0.3)',
          }}
        >
          Frenzy Drink
        </button>
        <button
          onClick={() => useGameStore.getState().onTestFrenzyKick?.()}
          style={{
            ...resetBtnStyle,
            flex: 1,
            background: 'rgba(255,140,50,0.15)',
            color: '#fa6',
            border: '1px solid rgba(255,140,50,0.3)',
          }}
        >
          Frenzy Kick
        </button>
      </div>
    </SettingsWindow>
  );
}

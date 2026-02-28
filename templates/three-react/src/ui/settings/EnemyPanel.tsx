import { useGameStore, type EnemyParams } from '../../store';
import { SettingsWindow, Section, Slider, Toggle, RangeSlider, resetBtnStyle } from './shared';

const accent = '#f66';

export function EnemyPanel() {
  const ep = useGameStore((s) => s.enemyParams);
  const set = useGameStore((s) => s.setEnemyParam);
  const setMelee = useGameStore((s) => s.setEnemyMeleeParam);
  const setRanged = useGameStore((s) => s.setEnemyRangedParam);

  return (
    <SettingsWindow>
      <Section label="Spawn" accent={accent} first>
        <Slider label="Max Enemies" value={ep.maxEnemies} min={0} max={20} step={1} accent={accent} onChange={(v) => set('maxEnemies', v)} />
        <Slider label="Respawn Time" value={ep.spawnInterval} min={2} max={60} step={1} accent={accent} onChange={(v) => set('spawnInterval', v)} />
      </Section>

      <Section label="Behaviour" accent={accent}>
        <Slider label="HP" value={ep.hp} min={1} max={20} step={1} accent={accent} onChange={(v) => set('hp', v)} />
        <Slider label="Player Dmg" value={ep.playerDamage} min={1} max={10} step={1} accent={accent} onChange={(v) => set('playerDamage', v)} />
        <Slider label="Chase Range" value={ep.chaseRange} min={1} max={20} step={0.5} accent={accent} onChange={(v) => set('chaseRange', v)} />
      </Section>

      <Section label="Move" accent={accent}>
        <RangeSlider label="Speed" value={ep.speed} min={0.2} max={6} step={0.1} accent={accent} onChange={(v) => set('speed', v)} />
      </Section>

      <Section label="Defense" accent={accent}>
        <Slider label="Invuln" value={ep.invulnDuration} min={0} max={2} step={0.05} accent={accent} onChange={(v) => set('invulnDuration', v)} />
        <Slider label="Stun" value={ep.stunDuration} min={0} max={1} step={0.05} accent={accent} onChange={(v) => set('stunDuration', v)} />
      </Section>

      <Section label="Melee" accent={accent}>
        <Slider label="Damage" value={ep.attackDamage} min={1} max={10} step={1} accent={accent} onChange={(v) => set('attackDamage', v)} />
        <Slider label="Knockback" value={ep.melee.knockback} min={0} max={15} step={0.5} accent={accent} onChange={(v) => setMelee('knockback', v)} />
        <Slider label="Cooldown" value={ep.attackCooldown} min={0.2} max={5} step={0.1} accent={accent} onChange={(v) => set('attackCooldown', v)} />
        <Toggle label="Slash effect" value={ep.melee.showSlashEffect} onChange={(v) => setMelee('showSlashEffect', v)} />
        <Toggle label="Exhaustion" value={ep.melee.exhaustionEnabled} onChange={(v) => setMelee('exhaustionEnabled', v)} />
      </Section>

      <Section label="Ranged" accent={accent}>
        <Toggle label="Enabled" value={ep.ranged.enabled} onChange={(v) => setRanged('enabled', v)} />
        {ep.ranged.enabled && (
          <>
            <Slider label="Knockback" value={ep.ranged.knockback} min={0} max={15} step={0.5} accent={accent} onChange={(v) => setRanged('knockback', v)} />
            <Toggle label="Exhaustion" value={ep.ranged.exhaustionEnabled} onChange={(v) => setRanged('exhaustionEnabled', v)} />
          </>
        )}
      </Section>

      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <button onClick={() => useGameStore.getState().onResetEnemyParams?.()} style={{ ...resetBtnStyle, flex: 1 }}>
          Reset Defaults
        </button>
        <button onClick={() => useGameStore.getState().onSpawnEnemy?.()} style={{ ...resetBtnStyle, flex: 1, background: 'rgba(100,200,255,0.15)', color: '#6cf', border: '1px solid rgba(100,200,255,0.3)' }}>
          Spawn Enemy
        </button>
      </div>
    </SettingsWindow>
  );
}

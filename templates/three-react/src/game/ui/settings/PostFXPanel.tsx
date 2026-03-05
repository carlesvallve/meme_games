import { useGameStore, DEFAULT_POST_PROCESS } from '../../../store';
import type { ParticleToggles } from '../../../store';
import {
  SettingsWindow,
  Section,
  Slider,
  Toggle,
  resetBtnStyle,
} from './shared';

const PARTICLE_TOGGLES: { key: keyof ParticleToggles; label: string }[] = [
  { key: 'dust', label: 'Dust' },
  { key: 'lightRain', label: 'Drizzle' },
  { key: 'rain', label: 'Rain' },
  { key: 'debris', label: 'Debris' },
];

export function PostFXPanel() {
  const postProcess = useGameStore((s) => s.postProcess);
  const setPostProcess = useGameStore((s) => s.setPostProcess);
  const particleToggles = useGameStore((s) => s.particleToggles);
  const toggleParticle = useGameStore((s) => s.toggleParticle);

  return (
    <SettingsWindow>
      <Section label='Particles' first>
        {PARTICLE_TOGGLES.map((t) => (
          <Toggle
            key={t.key}
            label={t.label}
            value={particleToggles[t.key]}
            onChange={() => toggleParticle(t.key)}
          />
        ))}
      </Section>

      <Section label='Post FX'>
        <Toggle
          label='Enabled'
          value={postProcess.enabled}
          onChange={(v) => setPostProcess({ ...postProcess, enabled: v })}
        />
      </Section>

      {postProcess.enabled && (
        <>
          <Section label='Bloom'>
            <Toggle
              label='Enabled'
              value={postProcess.bloom.enabled}
              onChange={(v) =>
                setPostProcess({
                  ...postProcess,
                  bloom: { ...postProcess.bloom, enabled: v },
                })
              }
            />
            {postProcess.bloom.enabled && (
              <>
                <Slider
                  label='Strength'
                  value={postProcess.bloom.strength}
                  min={0}
                  max={2}
                  step={0.05}
                  onChange={(v) =>
                    setPostProcess({
                      ...postProcess,
                      bloom: { ...postProcess.bloom, strength: v },
                    })
                  }
                />
                <Slider
                  label='Radius'
                  value={postProcess.bloom.radius}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(v) =>
                    setPostProcess({
                      ...postProcess,
                      bloom: { ...postProcess.bloom, radius: v },
                    })
                  }
                />
                <Slider
                  label='Threshold'
                  value={postProcess.bloom.threshold}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(v) =>
                    setPostProcess({
                      ...postProcess,
                      bloom: { ...postProcess.bloom, threshold: v },
                    })
                  }
                />
              </>
            )}
          </Section>

          <Section label='SSAO'>
            <Toggle
              label='Enabled'
              value={postProcess.ssao.enabled}
              onChange={(v) =>
                setPostProcess({
                  ...postProcess,
                  ssao: { ...postProcess.ssao, enabled: v },
                })
              }
            />
            {postProcess.ssao.enabled && (
              <>
                <Slider
                  label='Radius'
                  value={postProcess.ssao.radius}
                  min={0.01}
                  max={2}
                  step={0.01}
                  onChange={(v) =>
                    setPostProcess({
                      ...postProcess,
                      ssao: { ...postProcess.ssao, radius: v },
                    })
                  }
                />
                <Slider
                  label='Max Dist'
                  value={postProcess.ssao.maxDistance}
                  min={0.01}
                  max={0.5}
                  step={0.01}
                  onChange={(v) =>
                    setPostProcess({
                      ...postProcess,
                      ssao: { ...postProcess.ssao, maxDistance: v },
                    })
                  }
                />
              </>
            )}
          </Section>

          <Section label='Vignette'>
            <Toggle
              label='Enabled'
              value={postProcess.vignette.enabled}
              onChange={(v) =>
                setPostProcess({
                  ...postProcess,
                  vignette: { ...postProcess.vignette, enabled: v },
                })
              }
            />
            {postProcess.vignette.enabled && (
              <>
                <Slider
                  label='Offset'
                  value={postProcess.vignette.offset}
                  min={0}
                  max={3}
                  step={0.1}
                  onChange={(v) =>
                    setPostProcess({
                      ...postProcess,
                      vignette: { ...postProcess.vignette, offset: v },
                    })
                  }
                />
                <Slider
                  label='Darkness'
                  value={postProcess.vignette.darkness}
                  min={0}
                  max={3}
                  step={0.1}
                  onChange={(v) =>
                    setPostProcess({
                      ...postProcess,
                      vignette: { ...postProcess.vignette, darkness: v },
                    })
                  }
                />
              </>
            )}
          </Section>

          <Section label='Color Grade'>
            <Toggle
              label='Enabled'
              value={postProcess.colorGrade.enabled}
              onChange={(v) =>
                setPostProcess({
                  ...postProcess,
                  colorGrade: { ...postProcess.colorGrade, enabled: v },
                })
              }
            />
            {postProcess.colorGrade.enabled && (
              <>
                <Slider
                  label='Brightness'
                  value={postProcess.colorGrade.brightness}
                  min={-0.5}
                  max={0.5}
                  step={0.01}
                  onChange={(v) =>
                    setPostProcess({
                      ...postProcess,
                      colorGrade: { ...postProcess.colorGrade, brightness: v },
                    })
                  }
                />
                <Slider
                  label='Contrast'
                  value={postProcess.colorGrade.contrast}
                  min={-0.5}
                  max={0.5}
                  step={0.01}
                  onChange={(v) =>
                    setPostProcess({
                      ...postProcess,
                      colorGrade: { ...postProcess.colorGrade, contrast: v },
                    })
                  }
                />
                <Slider
                  label='Saturation'
                  value={postProcess.colorGrade.saturation}
                  min={-1}
                  max={1}
                  step={0.01}
                  onChange={(v) =>
                    setPostProcess({
                      ...postProcess,
                      colorGrade: { ...postProcess.colorGrade, saturation: v },
                    })
                  }
                />
              </>
            )}
          </Section>

          <button
            onClick={() => setPostProcess({ ...DEFAULT_POST_PROCESS })}
            style={resetBtnStyle}
          >
            Reset PostFX
          </button>
        </>
      )}
    </SettingsWindow>
  );
}

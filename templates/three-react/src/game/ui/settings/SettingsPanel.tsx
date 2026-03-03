import { useState, useEffect } from 'react';
import { useGameStore } from '../../../store';
import { useIsMobile, btnStyle } from './shared';
import { PlayerPanel } from './PlayerPanel';
import { EnemyPanel } from './EnemyPanel';
import { CameraPanel } from './CameraPanel';
import { LightPanel } from './LightPanel';
import { PostFXPanel } from './PostFXPanel';
import { ScenePanel } from './ScenePanel';

type ActivePanel = 'player' | 'enemy' | 'camera' | 'light' | 'postfx' | 'scene' | null;

export function SettingsPanel() {
  const [active, setActive] = useState<ActivePanel>(null);
  const isMobile = useIsMobile();
  const setSettingsPanelOpen = useGameStore((s) => s.setSettingsPanelOpen);

  useEffect(() => {
    setSettingsPanelOpen(active !== null);
    return () => setSettingsPanelOpen(false);
  }, [active, setSettingsPanelOpen]);

  const toggle = (panel: ActivePanel) =>
    setActive((cur) => (cur === panel ? null : panel));

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        ...(isMobile ? { left: 12 } : {}),
        zIndex: 100,
        pointerEvents: 'auto',
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        fontSize: 12,
        userSelect: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: isMobile ? 'stretch' : 'flex-end',
      }}
    >
      {active === 'player' && <PlayerPanel />}
      {active === 'enemy' && <EnemyPanel />}
      {active === 'camera' && <CameraPanel />}
      {active === 'light' && <LightPanel />}
      {active === 'postfx' && <PostFXPanel />}
      {active === 'scene' && <ScenePanel />}

      {/* Tab buttons */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
          gap: 4,
        }}
      >
        <button
          onClick={() => toggle('scene')}
          style={btnStyle(active === 'scene')}
        >
          Scene
        </button>
        <button
          onClick={() => toggle('player')}
          style={btnStyle(active === 'player')}
        >
          Player
        </button>
        <button
          onClick={() => toggle('enemy')}
          style={btnStyle(active === 'enemy')}
        >
          Enemy
        </button>
        <button
          onClick={() => toggle('camera')}
          style={btnStyle(active === 'camera')}
        >
          Camera
        </button>
        <button
          onClick={() => toggle('light')}
          style={btnStyle(active === 'light')}
        >
          Light
        </button>
        <button
          onClick={() => toggle('postfx')}
          style={btnStyle(active === 'postfx')}
        >
          PostFX
        </button>
      </div>
    </div>
  );
}

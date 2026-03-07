import { useGameStore } from '../../../store';
import { SettingsWindow, Section, Slider, Toggle, resetBtnStyle } from './shared';

const obstacleBtnStyle = {
  flex: 1,
  padding: '4px 10px',
  background: 'rgba(100,200,100,0.15)',
  color: '#8f8',
  border: '1px solid rgba(100,200,100,0.3)',
  borderRadius: 4,
  cursor: 'pointer' as const,
  fontSize: 11,
  fontWeight: 600,
};

const clearBtnStyle = {
  ...obstacleBtnStyle,
  background: 'rgba(200,150,100,0.15)',
  color: '#fa8',
  border: '1px solid rgba(200,150,100,0.3)',
};

export function WorldPanel() {
  const gridOpacity = useGameStore((s) => s.gridOpacity);
  const setGridOpacity = useGameStore((s) => s.setGridOpacity);
  const gridCellSize = useGameStore((s) => s.gridCellSize);
  const setGridCellSize = useGameStore((s) => s.setGridCellSize);
  const debugNavGrid = useGameStore((s) => s.debugNavGrid);
  const setDebugNavGrid = useGameStore((s) => s.setDebugNavGrid);
  const obstacleSnap = useGameStore((s) => s.obstacleSnap);
  const setObstacleSnap = useGameStore((s) => s.setObstacleSnap);

  return (
    <SettingsWindow>
      <Section label='Grid' first accent='#8f8'>
        <Slider
          label='Opacity'
          value={gridOpacity}
          min={0}
          max={1}
          step={0.05}
          accent='#8f8'
          onChange={setGridOpacity}
        />
        <Slider
          label='Cell Size'
          value={gridCellSize}
          min={0.25}
          max={4}
          step={0.25}
          accent='#8f8'
          onChange={setGridCellSize}
        />
      </Section>
      <Section label='Obstacles' accent='#8f8'>
        <Toggle label='Debug NavGrid' value={debugNavGrid} onChange={setDebugNavGrid} />
        <Toggle label='Snap to Grid' value={obstacleSnap} onChange={setObstacleSnap} />
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => useGameStore.getState().onGenerateObstacles?.()}
            style={obstacleBtnStyle}
          >
            Obstacles
          </button>
          <button
            onClick={() => useGameStore.getState().onGenerateTerrain?.()}
            style={obstacleBtnStyle}
          >
            Terrain
          </button>
          <button
            onClick={() => useGameStore.getState().onClearObstacles?.()}
            style={clearBtnStyle}
          >
            Clear
          </button>
        </div>
      </Section>
      <button
        onClick={() => useGameStore.setState({
          gridOpacity: 0.25,
          gridCellSize: 1,
        })}
        style={resetBtnStyle}
      >
        Reset Defaults
      </button>
    </SettingsWindow>
  );
}

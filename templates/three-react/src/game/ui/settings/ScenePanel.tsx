import { useGameStore } from '../../../store';
import type { TerrainPreset } from '../../terrain';
import type { HeightmapStyle } from '../../terrain';
import { palettes } from '../../terrain';
import {
  getPropCategories,
  getGroundTileIds,
  getDungeonVariants,
  swapGroundTiles,
} from '../../dungeon';
import {
  SettingsWindow,
  Section,
  Slider,
  RangeSlider,
  Toggle,
  btnStyle,
  resetBtnStyle,
  rowStyle,
  selectStyle,
} from './shared';

const PROP_CATEGORIES = getPropCategories().sort();
const GROUND_TILE_IDS = getGroundTileIds().sort();
const DUNGEON_VARIANT_OPTIONS = ['random', ...getDungeonVariants()];
const HEIGHTMAP_STYLES: HeightmapStyle[] = [
  'rolling',
  'terraces',
  'islands',
  'caves',
];
const PALETTE_NAMES = ['random', ...Object.keys(palettes)];

export function ScenePanel() {
  const terrainPreset = useGameStore((s) => s.terrainPreset);
  const heightmapStyle = useGameStore((s) => s.heightmapStyle);
  const setTerrainPreset = useGameStore((s) => s.setTerrainPreset);
  const setHeightmapStyle = useGameStore((s) => s.setHeightmapStyle);
  const regenerate = useGameStore((s) => s.onRegenerateScene);
  const heightmapThumb = useGameStore((s) => s.heightmapThumb);
  const walkableCells = useGameStore((s) => s.walkableCells);
  const paletteName = useGameStore((s) => s.paletteName);
  const paletteActive = useGameStore((s) => s.paletteActive);
  const setPaletteName = useGameStore((s) => s.setPaletteName);
  const gridOpacity = useGameStore((s) => s.gridOpacity);
  const setGridOpacity = useGameStore((s) => s.setGridOpacity);
  const roomSpacing = useGameStore((s) => s.roomSpacing);
  const setRoomSpacing = useGameStore((s) => s.setRoomSpacing);
  const roomSpacingMax = useGameStore((s) => s.roomSpacingMax);
  const setRoomSpacingMax = useGameStore((s) => s.setRoomSpacingMax);
  const tileSize = useGameStore((s) => s.tileSize);
  const setTileSize = useGameStore((s) => s.setTileSize);
  const resolutionScale = useGameStore((s) => s.resolutionScale);
  const setResolutionScale = useGameStore((s) => s.setResolutionScale);
  const testProp = useGameStore((s) => s.testProp);
  const setTestProp = useGameStore((s) => s.setTestProp);
  const testFloor = useGameStore((s) => s.testFloor);
  const setTestFloor = useGameStore((s) => s.setTestFloor);
  const doorChance = useGameStore((s) => s.doorChance);
  const setDoorChance = useGameStore((s) => s.setDoorChance);
  const heightChance = useGameStore((s) => s.heightChance);
  const setHeightChance = useGameStore((s) => s.setHeightChance);
  const loopChance = useGameStore((s) => s.loopChance);
  const setLoopChance = useGameStore((s) => s.setLoopChance);
  const dungeonSize = useGameStore((s) => s.dungeonSize);
  const setDungeonSize = useGameStore((s) => s.setDungeonSize);
  const roomLabels = useGameStore((s) => s.roomLabels);
  const setRoomLabels = useGameStore((s) => s.setRoomLabels);
  const natureEnabled = useGameStore((s) => s.natureEnabled);
  const setNatureEnabled = useGameStore((s) => s.setNatureEnabled);
  const useBiomes = useGameStore((s) => s.useBiomes);
  const setUseBiomes = useGameStore((s) => s.setUseBiomes);
  const debugBiomes = useGameStore((s) => s.debugBiomes);
  const setDebugBiomes = useGameStore((s) => s.setDebugBiomes);
  const debugDebris = useGameStore((s) => s.debugDebris);
  const setDebugDebris = useGameStore((s) => s.setDebugDebris);
  const propCategories = PROP_CATEGORIES;
  const dungeonVariant = useGameStore((s) => s.dungeonVariant);
  const setDungeonVariant = useGameStore((s) => s.setDungeonVariant);
  const hmrCacheEnabled = useGameStore((s) => s.hmrCacheEnabled);
  const setHmrCacheEnabled = useGameStore((s) => s.setHmrCacheEnabled);
  const remesh = useGameStore((s) => s.onRemesh);
  const randomizePalette = useGameStore((s) => s.onRandomizePalette);
  const applyPalette = useGameStore((s) => s.onApplyPalette);
  const forceStairs = useGameStore((s) => s.forceStairs);
  const setForceStairs = useGameStore((s) => s.setForceStairs);
  const progressiveLayout = useGameStore((s) => s.progressiveLayout);
  const setProgressiveLayout = useGameStore((s) => s.setProgressiveLayout);

  const hasPresetSettings =
    terrainPreset === 'heightmap' ||
    terrainPreset === 'voxelDungeon';

  const presetLabel =
    terrainPreset === 'voxelDungeon'
      ? 'Voxel Dungeon'
      : 'Heightmap';

  return (
    <SettingsWindow>
      {/* ── TERRAIN ── */}
      <Section label='Terrain' first>
        {heightmapThumb && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 4,
            }}
          >
            <img
              src={heightmapThumb}
              alt='heightmap'
              style={{
                width: 48,
                height: 48,
                imageRendering: 'pixelated',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 3,
              }}
            />
            <span style={{ fontSize: 10, color: '#999', lineHeight: 1.3 }}>
              {walkableCells} walkable cells
            </span>
          </div>
        )}
        <div style={rowStyle}>
          <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>
            Preset
          </span>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              flex: 1,
            }}
          >
            <div style={{ display: 'flex', gap: 3 }}>
              {(['basic', 'heightmap'] as TerrainPreset[]).map(
                (p) => (
                  <button
                    key={p}
                    onClick={() => { setTerrainPreset(p); regenerate?.(); }}
                    style={{
                      ...btnStyle(terrainPreset === p),
                      flex: 1,
                      textTransform: 'capitalize',
                    }}
                  >
                    {p}
                  </button>
                ),
              )}
            </div>
            <div style={{ display: 'flex', gap: 3 }}>
              {(['voxelDungeon', 'overworld'] as TerrainPreset[]).map(
                (p) => (
                  <button
                    key={p}
                    onClick={() => { setTerrainPreset(p); regenerate?.(); }}
                    style={{
                      ...btnStyle(terrainPreset === p),
                      flex: 1,
                      textTransform: 'capitalize',
                    }}
                  >
                    {p}
                  </button>
                ),
              )}
            </div>
          </div>
        </div>
      </Section>

      {/* ── PRESET-SPECIFIC ── */}
      {hasPresetSettings && (
        <Section label={presetLabel}>
          {terrainPreset === 'heightmap' && (
            <>
              <div style={rowStyle}>
                <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>
                  Style
                </span>
                <div style={{ display: 'flex', gap: 3, flex: 1 }}>
                  {HEIGHTMAP_STYLES.map((s) => (
                    <button
                      key={s}
                      onClick={() => setHeightmapStyle(s)}
                      style={{
                        ...btnStyle(heightmapStyle === s),
                        flex: 1,
                        textTransform: 'capitalize',
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <Toggle
                label='Nature'
                value={natureEnabled}
                onChange={setNatureEnabled}
              />
              {natureEnabled && (
                <>
                  <Toggle
                    label='Biomes'
                    value={useBiomes}
                    onChange={setUseBiomes}
                  />
                  <Toggle
                    label='Debug'
                    value={debugBiomes}
                    onChange={setDebugBiomes}
                  />
                </>
              )}
              <Toggle
                label='Debug Debris'
                value={debugDebris}
                onChange={setDebugDebris}
              />
            </>
          )}

          {terrainPreset === 'voxelDungeon' && (
            <>
              <RangeSlider
                label='Room Gap'
                value={[roomSpacing, roomSpacingMax]}
                min={1}
                max={8}
                step={1}
                onChange={([lo, hi]) => { setRoomSpacing(Math.round(lo)); setRoomSpacingMax(Math.round(hi)); }}
              />
              <Slider
                label='Dungeon Size'
                value={dungeonSize}
                min={12}
                max={60}
                step={4}
                onChange={(v) => setDungeonSize(Math.round(v))}
              />
              <div style={rowStyle}>
                <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>
                  Tile Size
                </span>
                <select
                  value={tileSize}
                  onChange={(e) => setTileSize(Number(e.target.value))}
                  style={selectStyle}
                >
                  <option value={0.25} disabled>0.25 — 1×1</option>
                  <option value={0.5} disabled>0.50 — 2×2</option>
                  <option value={0.75}>0.75 — 3×3</option>
                </select>
              </div>
              <div style={rowStyle}>
                <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>
                  Variant
                </span>
                <select
                  value={dungeonVariant}
                  onChange={(e) => setDungeonVariant(e.target.value)}
                  style={selectStyle}
                >
                  {DUNGEON_VARIANT_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v === 'random'
                        ? 'Random'
                        : v.replace('_', '-').toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
              <Slider
                label='Door Chance'
                value={doorChance}
                min={0}
                max={1}
                step={0.1}
                onChange={(v) => setDoorChance(v)}
              />
              <Slider
                label='Height Chance'
                value={heightChance}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => setHeightChance(v)}
              />
              <Slider
                label='Loop Chance'
                value={loopChance}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => setLoopChance(v)}
              />
              <Toggle
                label='Room Labels'
                value={roomLabels}
                onChange={setRoomLabels}
              />
              <Toggle
                label='Force Stairs'
                value={forceStairs}
                onChange={setForceStairs}
              />
              <Toggle
                label='Progressive Layout'
                value={progressiveLayout}
                onChange={setProgressiveLayout}
              />
              <div style={rowStyle}>
                <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>
                  Test Prop
                </span>
                <select
                  value={testProp}
                  onChange={(e) => setTestProp(e.target.value)}
                  style={selectStyle}
                >
                  <option value=''>All (templates)</option>
                  {propCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
              <div style={rowStyle}>
                <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>
                  Test Floor
                </span>
                <select
                  value={testFloor}
                  onChange={(e) => {
                    setTestFloor(e.target.value);
                    swapGroundTiles(e.target.value);
                  }}
                  style={selectStyle}
                >
                  <option value=''>Random</option>
                  {GROUND_TILE_IDS.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </Section>
      )}

      {/* ── DISPLAY ── */}
      <Section label='Display'>
        <div style={rowStyle}>
          <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>
            Palette
          </span>
          <select
            value={paletteName}
            onChange={(e) => { setPaletteName(e.target.value); applyPalette?.(e.target.value); }}
            style={{ ...selectStyle, textTransform: 'capitalize' }}
          >
            {PALETTE_NAMES.map((name) => (
              <option
                key={name}
                value={name}
                style={{ background: '#1a1a2a', color: '#ccc' }}
              >
                {name}
              </option>
            ))}
          </select>
          {paletteActive && (
            <span
              onClick={() => randomizePalette?.()}
              style={{
                color: '#6af',
                fontSize: 10,
                flexShrink: 0,
                textTransform: 'capitalize',
                cursor: 'pointer',
                padding: '2px 4px',
                borderRadius: 3,
                background: 'rgba(100,170,255,0.1)',
              }}
              title='Click to randomize palette'
            >
              {paletteActive}
            </span>
          )}
        </div>
        <Slider
          label='Grid'
          value={gridOpacity}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => setGridOpacity(v)}
        />
        <Slider
          label='Resolution'
          value={resolutionScale}
          min={0.5}
          max={3}
          step={0.5}
          onChange={(v) => {
            setResolutionScale(v);
            clearTimeout((window as any).__remeshTimer);
            (window as any).__remeshTimer = setTimeout(() => remesh?.(), 300);
          }}
        />
        <Toggle
          label='HMR Cache'
          value={hmrCacheEnabled}
          onChange={setHmrCacheEnabled}
        />
      </Section>

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <button
          onClick={() => useGameStore.getState().onResetSceneParams?.()}
          style={{ ...resetBtnStyle, marginTop: 0, flex: 1 }}
        >
          Reset
        </button>
        <button
          onClick={() => regenerate?.()}
          style={{
            flex: 1,
            padding: '4px 12px',
            background: 'rgba(100,220,120,0.2)',
            color: '#8f8',
            border: '1px solid rgba(100,220,120,0.4)',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          Regenerate
        </button>
      </div>
    </SettingsWindow>
  );
}

import { useGameStore, type CameraParams, type CameraMode } from '../../../store';
import {
  SettingsWindow,
  Section,
  Slider,
  Select,
  CollisionLayerSelect,
  resetBtnStyle,
} from './shared';

const CAMERA_MODES: string[] = ['topdown', 'thirdperson'];

export function CameraPanel() {
  const cameraParams = useGameStore((s) => s.cameraParams);
  const setCameraParam = useGameStore((s) => s.setCameraParam);

  return (
    <SettingsWindow windowId="camera">
      <Section label='Camera' first accent='#8f8'>
        <Select
          label='Mode'
          value={cameraParams.cameraMode}
          options={CAMERA_MODES}
          onChange={(v) => setCameraParam('cameraMode', v as CameraMode)}
        />
        <Slider
          label='FOV'
          value={cameraParams.fov}
          min={30} max={90} step={5}
          onChange={(v) => setCameraParam('fov', v)}
        />
        {cameraParams.cameraMode === 'thirdperson' && (
          <Slider
            label='Laziness'
            value={cameraParams.followLaziness}
            min={0} max={1} step={0.05}
            onChange={(v) => setCameraParam('followLaziness', v)}
          />
        )}
      </Section>

      <Section label='Zoom'>
        <Slider
          label='Distance'
          value={cameraParams.distance}
          min={0.5} max={40} step={0.5}
          onChange={(v) => setCameraParam('distance', v)}
        />
        <Slider
          label='Min'
          value={cameraParams.minDistance}
          min={0.5} max={15} step={0.5}
          onChange={(v) => setCameraParam('minDistance', v)}
        />
        <Slider
          label='Max'
          value={cameraParams.maxDistance}
          min={10} max={40} step={0.5}
          onChange={(v) => setCameraParam('maxDistance', v)}
        />
        <Slider
          label='Speed'
          value={cameraParams.zoomSpeed}
          min={0.005} max={0.05} step={0.005}
          onChange={(v) => setCameraParam('zoomSpeed', v)}
        />
      </Section>

      <Section label='Rotation'>
        <Slider
          label='Pitch Min'
          value={cameraParams.pitchMin}
          min={-89} max={-20} step={1}
          onChange={(v) => setCameraParam('pitchMin', v)}
        />
        <Slider
          label='Pitch Max'
          value={cameraParams.pitchMax}
          min={-50} max={45} step={1}
          onChange={(v) => setCameraParam('pitchMax', v)}
        />
        <Slider
          label='Speed'
          value={cameraParams.rotationSpeed}
          min={0.001} max={0.02} step={0.001}
          onChange={(v) => setCameraParam('rotationSpeed', v)}
        />
      </Section>

      <Section label='Target Offset'>
        <Slider
          label='X'
          value={cameraParams.targetOffset[0]}
          min={-3} max={3} step={0.1}
          onChange={(v) => setCameraParam('targetOffset', [v, cameraParams.targetOffset[1], cameraParams.targetOffset[2]])}
        />
        <Slider
          label='Y'
          value={cameraParams.targetOffset[1]}
          min={0} max={3} step={0.1}
          onChange={(v) => setCameraParam('targetOffset', [cameraParams.targetOffset[0], v, cameraParams.targetOffset[2]])}
        />
        <Slider
          label='Z'
          value={cameraParams.targetOffset[2]}
          min={-3} max={3} step={0.1}
          onChange={(v) => setCameraParam('targetOffset', [cameraParams.targetOffset[0], cameraParams.targetOffset[1], v])}
        />
      </Section>

      <Section label='Collision'>
        <Slider
          label='Skin'
          value={cameraParams.collisionSkin}
          min={0.05} max={1.0} step={0.05}
          onChange={(v) => setCameraParam('collisionSkin', v)}
        />
        <CollisionLayerSelect
          value={cameraParams.collisionLayers}
          onChange={(v) => setCameraParam('collisionLayers', v)}
        />
      </Section>

      <button
        onClick={() => useGameStore.getState().onResetCameraParams?.()}
        style={resetBtnStyle}
      >
        Reset Defaults
      </button>
    </SettingsWindow>
  );
}

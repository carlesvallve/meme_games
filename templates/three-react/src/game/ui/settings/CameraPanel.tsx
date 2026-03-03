import { useGameStore, type CameraParams } from '../../../store';
import {
  SettingsWindow,
  Section,
  Slider,
  CollisionLayerSelect,
  type SliderDef,
  resetBtnStyle,
} from './shared';

const CAMERA_PARAMS: SliderDef<keyof CameraParams>[] = [
  { key: 'fov', label: 'FOV', min: 30, max: 90, step: 5 },
  { key: 'distance', label: 'Zoom', min: 2, max: 40, step: 0.5 },
  { key: 'minDistance', label: 'Zoom Min', min: 2, max: 15, step: 0.5 },
  { key: 'maxDistance', label: 'Zoom Max', min: 10, max: 40, step: 0.5 },
  { key: 'pitchMin', label: 'Pitch Min', min: -89, max: -20, step: 1 },
  { key: 'pitchMax', label: 'Pitch Max', min: -50, max: 45, step: 1 },
  {
    key: 'rotationSpeed',
    label: 'Rotation',
    min: 0.001,
    max: 0.02,
    step: 0.001,
  },
  { key: 'zoomSpeed', label: 'Zoom Speed', min: 0.005, max: 0.05, step: 0.005 },
  { key: 'collisionSkin', label: 'Col. Skin', min: 0.05, max: 1.0, step: 0.05 },
];

export function CameraPanel() {
  const cameraParams = useGameStore((s) => s.cameraParams);
  const setCameraParam = useGameStore((s) => s.setCameraParam);

  return (
    <SettingsWindow>
      <Section label='Camera' first>
        {CAMERA_PARAMS.map(({ key, label, min, max, step }) => (
          <Slider
            key={key}
            label={label}
            value={cameraParams[key] as number}
            min={min}
            max={max}
            step={step}
            onChange={(v) => setCameraParam(key, v)}
          />
        ))}
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

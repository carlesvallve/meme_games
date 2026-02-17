"use client";

import { Canvas } from "@react-three/fiber";
import { GameScene } from "./GameScene";

export default function GameCanvas() {
  return (
    <Canvas
      camera={{ position: [0, 2, 5], fov: 60 }}
      className="!w-full !h-full"
    >
      <GameScene />
    </Canvas>
  );
}

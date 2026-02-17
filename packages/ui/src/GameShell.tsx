"use client";

import React, { type ComponentType } from "react";
import dynamic from "next/dynamic";

interface GameShellProps {
  /** The game canvas component to render (will be dynamically imported with SSR disabled). */
  gameComponent: () => Promise<{ default: ComponentType }>;
}

/**
 * Full-viewport wrapper that dynamically imports a game component with SSR disabled.
 * Usage in page.tsx:
 *   <GameShell gameComponent={() => import("@/game/GameCanvas")} />
 */
export function GameShell({ gameComponent }: GameShellProps) {
  const GameCanvas = React.useMemo(
    () => dynamic(gameComponent, { ssr: false }),
    [gameComponent],
  );

  return (
    <main style={{ width: "100%", height: "100%" }}>
      <GameCanvas />
    </main>
  );
}

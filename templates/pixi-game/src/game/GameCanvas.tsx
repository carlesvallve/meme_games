"use client";

import { useEffect, useRef } from "react";
import { createGame } from "./Game";

export default function GameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const cleanup = createGame(container);

    return () => {
      cleanup.then((destroy) => destroy());
    };
  }, []);

  return <div ref={containerRef} className="w-full h-full" />;
}

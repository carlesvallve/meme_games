"use client";

import { GameShell } from "@sttg/ui";

export default function Home() {
  return <GameShell gameComponent={() => import("@/game/GameCanvas")} />;
}

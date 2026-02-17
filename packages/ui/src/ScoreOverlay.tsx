"use client";

import React from "react";

interface ScoreOverlayProps {
  score: number;
  label?: string;
  className?: string;
}

export function ScoreOverlay({ score, label = "Score", className }: ScoreOverlayProps) {
  return (
    <div
      className={className}
      style={
        !className
          ? {
              position: "absolute",
              top: 16,
              right: 16,
              padding: "8px 16px",
              background: "rgba(0, 0, 0, 0.7)",
              color: "#fff",
              borderRadius: "8px",
              fontSize: "18px",
              fontFamily: "monospace",
              pointerEvents: "none",
              zIndex: 10,
            }
          : undefined
      }
    >
      {label}: {score}
    </div>
  );
}

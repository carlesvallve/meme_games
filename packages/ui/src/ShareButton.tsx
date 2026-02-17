"use client";

import React from "react";
import { shareToX } from "@sttg/social/share";

interface ShareButtonProps {
  text: string;
  url?: string;
  className?: string;
  children?: React.ReactNode;
}

export function ShareButton({ text, url, className, children }: ShareButtonProps) {
  return (
    <button
      onClick={() => shareToX(text, url)}
      className={className}
      style={
        !className
          ? {
              padding: "8px 16px",
              background: "#000",
              color: "#fff",
              border: "1px solid #333",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "14px",
            }
          : undefined
      }
    >
      {children ?? "Share on X"}
    </button>
  );
}

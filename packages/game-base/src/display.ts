export interface DisplayConfig {
  DPR: number;
  PX: number;
  GAME: {
    WIDTH: number;
    HEIGHT: number;
    IS_PORTRAIT: boolean;
    IS_MOBILE: boolean;
    GRAVITY: number;
  };
}

export interface DisplayOptions {
  maxDPR?: number;
  designWidth?: number;
  designHeight?: number;
  gravity?: number;
}

export function createDisplayConfig(opts: DisplayOptions = {}): DisplayConfig {
  const {
    maxDPR = 2,
    designWidth,
    designHeight,
    gravity = 800,
  } = opts;

  const DPR = Math.min(window.devicePixelRatio || 1, maxDPR);

  const isPortrait = window.innerHeight > window.innerWidth;

  const dw = designWidth ?? (isPortrait ? 540 : 960);
  const dh = designHeight ?? (isPortrait ? 960 : 540);
  const designAspect = dw / dh;

  const deviceW = window.innerWidth * DPR;
  const deviceH = window.innerHeight * DPR;

  // Mobile detection: touch-capable and either narrow or portrait
  const isMobile = (navigator.maxTouchPoints > 0) &&
    (window.innerWidth <= 1024 || isPortrait);

  let canvasW: number;
  let canvasH: number;

  if (isMobile) {
    // On mobile: match actual device pixels — no letterboxing
    canvasW = deviceW;
    canvasH = deviceH;
  } else {
    // Desktop: cover strategy (fill + overflow)
    if (deviceW / deviceH > designAspect) {
      canvasW = deviceW;
      canvasH = Math.round(deviceW / designAspect);
    } else {
      canvasW = Math.round(deviceH * designAspect);
      canvasH = deviceH;
    }
  }

  // On mobile use the smaller axis ratio to prevent clipping
  const PX = isMobile
    ? Math.min(canvasW / dw, canvasH / dh)
    : canvasW / dw;

  return {
    DPR,
    PX,
    GAME: {
      WIDTH: canvasW,
      HEIGHT: canvasH,
      IS_PORTRAIT: isPortrait,
      IS_MOBILE: isMobile,
      GRAVITY: gravity * PX,
    },
  };
}

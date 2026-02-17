let cachedId: string | null = null;

/** Canvas fingerprint + screen dims + userAgent -> SHA-256 hex (64 chars). */
async function generateFingerprint(gameId: string): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 200;
  canvas.height = 50;
  const ctx = canvas.getContext("2d")!;
  ctx.textBaseline = "alphabetic";
  ctx.font = "14px monospace";
  ctx.fillText(`${gameId}_fp`, 2, 15);
  ctx.fillStyle = "#fa0";
  ctx.fillRect(100, 0, 80, 25);
  ctx.fillStyle = "#069";
  ctx.font = "18px serif";
  ctx.fillText("fp", 105, 20);

  const canvasData = canvas.toDataURL();
  const raw = canvasData + "|" + screen.width + "x" + screen.height + "|" + navigator.userAgent;

  const buf = new TextEncoder().encode(raw);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  const arr = new Uint8Array(hash);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Returns the player's persistent anonymous ID (64-char hex). */
export async function getPlayerId(gameId: string): Promise<string> {
  if (cachedId) return cachedId;

  const storageKey = `${gameId}_player_id`;

  try {
    const stored = localStorage.getItem(storageKey);
    if (stored && stored.length === 64) {
      cachedId = stored;
      return stored;
    }
  } catch {
    // localStorage unavailable
  }

  const id = await generateFingerprint(gameId);
  cachedId = id;

  try {
    localStorage.setItem(storageKey, id);
  } catch {
    // localStorage unavailable
  }

  return id;
}

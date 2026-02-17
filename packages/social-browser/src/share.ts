/** Opens a Twitter/X share intent in a new window. */
export function shareToX(text: string, url?: string): void {
  const params = new URLSearchParams({ text });
  if (url) params.set("url", url);
  window.open(
    `https://x.com/intent/tweet?${params.toString()}`,
    "_blank",
    "noopener,noreferrer",
  );
}

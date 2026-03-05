import { CSSProperties, useEffect, useRef, useState } from 'react';
import { TextScramble } from '../utils/TextScramble';

/** Fade style for scramble transitions to/from empty. */
const FADE_STYLE: CSSProperties = { transition: 'opacity 0.4s ease-out' };

/**
 * React hook that animates a left-to-right text scramble transition
 * whenever `target` changes. Wraps the framework-agnostic TextScramble class.
 *
 * Returns [displayText, fadeStyle]. Apply `fadeStyle` to the element to get
 * automatic opacity fade-in when scrambling from empty and fade-out when
 * scrambling to empty.
 */
export function useTextScramble(target: string, duration = 600): [string, CSSProperties] {
  const [display, setDisplay] = useState(target);
  const [opacity, setOpacity] = useState(target ? 1 : 0);
  const scrambleRef = useRef<TextScramble | null>(null);
  const prevTargetRef = useRef(target);

  useEffect(() => {
    const s = new TextScramble(target, duration);
    s.onChange = setDisplay;
    scrambleRef.current = s;
    return () => s.dispose();
  }, [duration]);

  useEffect(() => {
    const prev = prevTargetRef.current;
    prevTargetRef.current = target;
    scrambleRef.current?.scrambleTo(target);

    // Fade in when going from empty to text, fade out when going to empty
    if (!prev && target) {
      // Defer so the browser sees opacity:0 first, then transitions to 1
      requestAnimationFrame(() => setOpacity(1));
    } else if (prev && !target) {
      requestAnimationFrame(() => setOpacity(0));
    }
  }, [target]);

  const style: CSSProperties = { ...FADE_STYLE, opacity };

  return [display, style];
}

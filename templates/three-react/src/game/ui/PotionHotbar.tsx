import { useGameStore } from '../../store';
import { POTION_HUES, EFFECT_META } from '../combat';

/** Convert HSL hue (0-1) to a CSS hex color for display */
function hueToHex(hue: number): string {
  // HSL → RGB via three-step conversion
  const s = 0.7,
    l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const h6 = hue * 6;
  const x = c * (1 - Math.abs((h6 % 2) - 1));
  let r = 0,
    g = 0,
    b = 0;
  if (h6 < 1) {
    r = c;
    g = x;
  } else if (h6 < 2) {
    r = x;
    g = c;
  } else if (h6 < 3) {
    g = c;
    b = x;
  } else if (h6 < 4) {
    g = x;
    b = c;
  } else if (h6 < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const m = l - c / 2;
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const SLOT_COLORS = POTION_HUES.map(hueToHex);

export function PotionHotbar() {
  const inventory = useGameStore((s) => s.potionInventory);
  const onDrinkPotion = useGameStore((s) => s.onDrinkPotion);
  const activePotionEffects = useGameStore((s) => s.activePotionEffects);

  if (inventory.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 58,
        right: 12,
        display: 'flex',
        flexDirection: 'row-reverse',
        gap: 4,
        pointerEvents: 'auto',
        userSelect: 'none',
      }}
    >
      {inventory.map((slot) => {
        const color = SLOT_COLORS[slot.colorIndex] ?? '#888';
        // Check if this potion's effect is currently active
        const ps = (window as any).__potionEffectSystem as
          | import('../combat/PotionEffectSystem').PotionEffectSystem
          | null;
        const identified = ps?.isIdentified(slot.colorIndex) ?? false;
        const effect = ps?.colorMapping[slot.colorIndex];
        const meta = effect ? EFFECT_META[effect] : null;
        const label = identified && meta ? meta.label : '???';
        const positive = meta?.positive ?? true;
        const isActive = activePotionEffects.some((e) => effect === e.effect);

        return (
          <div
            key={slot.colorIndex}
            onClick={() => onDrinkPotion?.(slot.colorIndex)}
            style={{
              width: 40,
              height: 48,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              background: isActive
                ? 'rgba(255,255,255,0.15)'
                : 'rgba(0,0,0,0.55)',
              border: `2px solid ${color}`,
              borderRadius: 6,
              cursor: 'pointer',
              position: 'relative',
              transition: 'transform 0.1s, background 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.transform =
                'scale(1.1)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)';
            }}
            onMouseDown={(e) => {
              (e.currentTarget as HTMLDivElement).style.transform =
                'scale(0.95)';
            }}
            onMouseUp={(e) => {
              (e.currentTarget as HTMLDivElement).style.transform =
                'scale(1.1)';
            }}
          >
            {/* Potion dot */}
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: color,
                boxShadow: `0 0 6px ${color}88`,
              }}
            />
            {/* Label */}
            <span
              style={{
                fontSize: 7,
                fontWeight: 600,
                color: !identified ? '#aaa' : positive ? '#6f6' : '#f66',
                lineHeight: 1,
                textAlign: 'center',
                textShadow: '0 1px 2px rgba(0,0,0,0.8)',
              }}
            >
              {label}
            </span>
            {/* Stack count */}
            {slot.count > 1 && (
              <span
                style={{
                  position: 'absolute',
                  bottom: 1,
                  right: 3,
                  fontSize: 9,
                  fontWeight: 700,
                  color: '#fff',
                  textShadow: '0 1px 2px rgba(0,0,0,0.9)',
                  lineHeight: 1,
                }}
              >
                {slot.count}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

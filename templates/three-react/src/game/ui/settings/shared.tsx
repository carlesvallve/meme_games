import { useState, useRef, useEffect } from 'react';
import { Layer } from '../../core/Entity';

/* ── Constants ── */

export const MOBILE_BREAKPOINT = 640;

/* ── Hooks ── */

export function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT);
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return mobile;
}

/* ── Types ── */

export interface SliderDef<K> {
  key: K;
  label: string;
  min: number;
  max: number;
  step: number;
}

/* ── Styles ── */

export const btnStyle = (active: boolean) => ({
  padding: '4px 10px',
  background: active ? 'rgba(100,170,255,0.3)' : 'rgba(0,0,0,0.6)',
  color: active ? '#fff' : '#ccc',
  border: `1px solid ${active ? 'rgba(100,170,255,0.5)' : 'rgba(255,255,255,0.15)'}`,
  borderRadius: 4,
  cursor: 'pointer' as const,
  fontSize: 11,
});

export const panelStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.7)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 6,
  padding: '8px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 220,
  maxWidth: '100%',
  maxHeight: 'calc(100svh - 52px)',
  overflowY: 'auto',
  boxSizing: 'border-box',
};

export const resetBtnStyle = {
  marginTop: 4,
  padding: '4px 12px',
  background: 'rgba(255,100,100,0.15)',
  color: '#f88',
  border: '1px solid rgba(255,100,100,0.3)',
  borderRadius: 4,
  cursor: 'pointer' as const,
  fontSize: 11,
  fontWeight: 600,
  width: '100%',
};

export const sectionTitle = {
  color: '#6af',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 1.5,
} as const;

export const separator = {
  borderTop: '1px solid rgba(255,255,255,0.1)',
  paddingTop: 6,
  marginTop: 4,
} as const;

export const ROW_HEIGHT = 20;
export const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, minHeight: ROW_HEIGHT };

export function Section({ label, accent, first, children }: {
  label: string; accent?: string; first?: boolean; children: React.ReactNode;
}) {
  return (
    <div style={{
      ...(first ? undefined : separator),
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ ...sectionTitle, ...(accent ? { color: accent } : undefined) }}>{label.toUpperCase()}</div>
      {children}
    </div>
  );
}

export const selectStyle: React.CSSProperties = {
  flex: 1, padding: '2px 6px',
  background: 'rgba(255,255,255,0.08)', color: '#ccc',
  border: '1px solid rgba(255,255,255,0.2)', borderRadius: 3,
  fontSize: 11, cursor: 'pointer',
};

/* ── Components ── */

export function SettingsWindow({ children }: { children: React.ReactNode }) {
  useEffect(() => { injectRangeStyles(); }, []);
  return (
    <div
      style={{ ...panelStyle, marginBottom: 8, touchAction: 'pan-y' }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={rowStyle}>
      <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>{label}</span>
      <button
        onClick={() => onChange(!value)}
        style={{
          padding: '2px 8px',
          minWidth: 32, maxWidth: 40,
          background: value ? 'rgba(100,170,255,0.25)' : 'rgba(255,80,80,0.15)',
          color: value ? '#6af' : '#f66',
          border: `1px solid ${value ? 'rgba(100,170,255,0.4)' : 'rgba(255,80,80,0.3)'}`,
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: value ? 600 : 400,
          transition: 'all 0.15s',
          margin: 0,
        }}
      >
        {value ? 'on' : 'off'}
      </button>
    </div>
  );
}

/* ── Multi-Select Dropdown ── */

export function MultiSelect({ label, options, selected, allLabel = 'All', accent = '#6af', direction = 'down', onChange }: {
  label: string;
  options: { label: string; value: string }[];
  selected: string[];
  allLabel?: string;
  accent?: string;
  direction?: 'up' | 'down';
  onChange: (selected: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open]);

  const selectedSet = new Set(selected);
  const allSelected = selected.length === 0;
  const activeLabels = allSelected
    ? [allLabel]
    : options.filter(o => selectedSet.has(o.value)).map(o => o.label);
  const summary = activeLabels.join(', ');

  const toggle = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(selected.filter(v => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const toggleAll = () => {
    onChange([]);
  };

  return (
    <div ref={ref} style={{ position: 'relative', marginTop: 2 }}>
      <div style={rowStyle}>
        <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>{label}</span>
        <button
          onClick={() => setOpen(!open)}
          style={{
            flex: 1,
            padding: '2px 6px',
            background: 'rgba(255,255,255,0.08)',
            color: '#ccc',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 3,
            cursor: 'pointer',
            fontSize: 11,
            textAlign: 'left',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {summary} ▾
        </button>
      </div>
      {open && (
        <div
          style={{
            position: 'absolute',
            ...(direction === 'up'
              ? { bottom: '100%', marginBottom: 2 }
              : { top: '100%', marginTop: 2 }),
            left: 90 + 6,
            background: 'rgba(20,20,30,0.95)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 4,
            padding: '4px 0',
            zIndex: 10,
            minWidth: 130,
            maxHeight: 250,
            overflowY: 'auto',
          }}
        >
          <label
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '3px 10px', cursor: 'pointer',
              color: allSelected ? '#fff' : '#888', fontSize: 11,
              borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: 2, paddingBottom: 5,
            }}
          >
            <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ accentColor: accent }} />
            {allLabel}
          </label>
          {options.map((opt) => {
            const checked = selectedSet.has(opt.value);
            return (
              <label
                key={opt.value}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '3px 10px', cursor: 'pointer',
                  color: checked ? '#fff' : '#888', fontSize: 11,
                }}
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(opt.value)} style={{ accentColor: accent }} />
                {opt.label}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Collision Layer Select ── */

const LAYER_OPTIONS: { label: string; value: number }[] = [
  { label: 'Architecture', value: Layer.Architecture },
  { label: 'Collectible', value: Layer.Collectible },
  { label: 'Character', value: Layer.Character },
  { label: 'Prop', value: Layer.Prop },
  { label: 'Light', value: Layer.Light },
  { label: 'Particle', value: Layer.Particle },
];

export function CollisionLayerSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open]);

  const activeLabels = LAYER_OPTIONS.filter((o) => value & o.value).map((o) => o.label);
  const summary = activeLabels.length === 0 ? 'None' : activeLabels.join(', ');

  const toggle = (layerBit: number) => {
    onChange(value ^ layerBit);
  };

  return (
    <div ref={ref} style={{ position: 'relative', marginTop: 2 }}>
      <div style={rowStyle}>
        <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>Collisions</span>
        <button
          onClick={() => setOpen(!open)}
          style={{
            flex: 1,
            padding: '2px 6px',
            background: 'rgba(255,255,255,0.08)',
            color: '#ccc',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 3,
            cursor: 'pointer',
            fontSize: 11,
            textAlign: 'left',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {summary} ▾
        </button>
      </div>
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 90 + 6,
            marginBottom: 2,
            background: 'rgba(20,20,30,0.95)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 4,
            padding: '4px 0',
            zIndex: 10,
            minWidth: 130,
          }}
        >
          {LAYER_OPTIONS.map((opt) => {
            const checked = !!(value & opt.value);
            return (
              <label
                key={opt.value}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 10px',
                  cursor: 'pointer',
                  color: checked ? '#fff' : '#888',
                  fontSize: 11,
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt.value)}
                  style={{ accentColor: '#6af' }}
                />
                {opt.label}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Slider ── */

export function Slider({ label, value, min, max, step, accent = '#6af', onChange }: {
  label: string; value: number; min: number; max: number; step: number; accent?: string; onChange: (v: number) => void;
}) {
  return (
    <div style={rowStyle}>
      <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={sliderFillStyle(value, min, max, accent)}
      />
      <span style={{ color: '#fff', width: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {value.toFixed(decimals(step))}
      </span>
    </div>
  );
}

/* ── Range Slider ── */

// Inject slider styles once
let rangeStyleInjected = false;
function injectRangeStyles() {
  if (rangeStyleInjected) return;
  rangeStyleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    input[type="range"] { -webkit-appearance: none; appearance: none; background: transparent; outline: none; --thumb-color: #6af; --fill-pct: 0%; }
    input[type="range"]::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: linear-gradient(to right, var(--thumb-color) 0%, var(--thumb-color) var(--fill-pct), rgba(255,255,255,0.1) var(--fill-pct), rgba(255,255,255,0.1) 100%); border: none; }
    input[type="range"]::-moz-range-track { height: 4px; border-radius: 2px; background: linear-gradient(to right, var(--thumb-color) 0%, var(--thumb-color) var(--fill-pct), rgba(255,255,255,0.1) var(--fill-pct), rgba(255,255,255,0.1) 100%); border: none; }
    input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: var(--thumb-color); border: none; cursor: pointer; margin-top: -4px; }
    input[type="range"]::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: var(--thumb-color); border: none; cursor: pointer; }
    input[type="range"]:focus { outline: none; }
    input.rs-thumb { pointer-events: none; }
    input.rs-thumb::-webkit-slider-runnable-track { background: transparent; }
    input.rs-thumb::-moz-range-track { background: transparent; }
    input.rs-thumb::-webkit-slider-thumb { background: transparent; pointer-events: auto; }
    input.rs-thumb::-moz-range-thumb { background: transparent; pointer-events: auto; }
  `;
  document.head.appendChild(style);
}

export function RangeSlider({ label, value, min, max, step, accent = '#6af', onChange }: {
  label: string;
  value: [number, number];
  min: number;
  max: number;
  step: number;
  accent?: string;
  onChange: (v: [number, number]) => void;
}) {
  useEffect(() => { injectRangeStyles(); }, []);

  const lo = value?.[0] ?? min;
  const hi = value?.[1] ?? max;
  const pctLo = ((lo - min) / (max - min)) * 100;
  const pctHi = ((hi - min) / (max - min)) * 100;
  const isRange = Math.abs(hi - lo) > step * 0.5;
  const dec = decimals(step);

  // When thumbs overlap, decide which one to move based on drag direction
  const loRef = useRef<HTMLInputElement>(null);
  const hiRef = useRef<HTMLInputElement>(null);

  const inputStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    margin: 0,
    padding: 0,
  };

  return (
    <div style={rowStyle}>
      <span style={{ color: '#aaa', width: 90, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, position: 'relative', height: 14 }}>
        {/* Track background */}
        <div style={{
          position: 'absolute', top: '50%', left: 0, right: 0,
          height: 4, marginTop: -2, borderRadius: 2,
          background: 'rgba(255,255,255,0.1)', pointerEvents: 'none',
        }} />
        {/* Active range highlight */}
        {isRange && <div style={{
          position: 'absolute', top: '50%',
          left: `${pctLo}%`, width: `${pctHi - pctLo}%`,
          height: 4, marginTop: -2, borderRadius: 2,
          background: accent, opacity: 0.4, pointerEvents: 'none',
        }} />}
        {/* Low thumb — behind, z-index 3 */}
        <input
          ref={loRef}
          className="rs-thumb"
          type="range"
          min={min} max={max} step={step}
          value={lo}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            onChange([Math.min(v, hi), hi]);
          }}
          style={{ ...inputStyle, zIndex: pctLo > 50 ? 4 : 3 }}
        />
        {/* High thumb — on top, z-index 4 */}
        <input
          ref={hiRef}
          className="rs-thumb"
          type="range"
          min={min} max={max} step={step}
          value={hi}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            onChange([lo, Math.max(v, lo)]);
          }}
          style={{ ...inputStyle, zIndex: pctLo > 50 ? 3 : 4 }}
        />
        {/* Colored thumb overlays (visual only) */}
        <div style={{
          position: 'absolute', top: '50%', marginTop: -6,
          left: `calc(${pctLo}% - 6px)`, width: 12, height: 12,
          borderRadius: '50%', background: accent, pointerEvents: 'none', zIndex: 5,
        }} />
        <div style={{
          position: 'absolute', top: '50%', marginTop: -6,
          left: `calc(${pctHi}% - 6px)`, width: 12, height: 12,
          borderRadius: '50%', background: accent, pointerEvents: 'none', zIndex: 5,
        }} />
      </div>
      <span style={{ color: '#fff', width: isRange ? 60 : 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {isRange ? `${lo.toFixed(dec)}-${hi.toFixed(dec)}` : lo.toFixed(dec)}
      </span>
    </div>
  );
}

/* ── Helpers ── */

export const decimals = (step: number) => (step < 0.01 ? 3 : step < 0.1 ? 2 : 1);

/** Compute inline style with --fill-pct for colored track fill */
export const sliderFillStyle = (value: number, min: number, max: number, color: string): React.CSSProperties => ({
  flex: 1,
  height: 14,
  ['--fill-pct' as any]: `${((value - min) / (max - min)) * 100}%`,
  ['--thumb-color' as any]: color,
});

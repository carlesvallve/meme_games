import { useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store';
import { CHARACTER_TEAM_COLORS, getSlots, voxRoster } from '../game/character';
import type { CharacterType } from '../game/character';
import { audioSystem } from '../utils/AudioSystem';

/** Per-hero emoji for the character select grid */
const HERO_ICONS: Record<string, string> = {
  adventurer: '🧭',
  alchemist: '⚗️',
  amazon: '🔱',
  archer: '🏹',
  barbarian: '🪓',
  bard: '🎵',
  knight: '⚔️',
  mage: '✨',
  monk: '☯️',
  necromancer: '💀',
  priestess: '🙏',
  rogue: '🎭',
};

/** Delay before accepting Space/Enter after mount (prevents attack-spam carry-over) */
const INPUT_GUARD_MS = 400;

const COLUMNS = 4;

export function CharacterSelect() {
  const selectCharacter = useGameStore((s) => s.selectCharacter);
  const slots = getSlots();

  // Index 0 = Random, 1..N = actual characters
  const totalItems = slots.length + 1;
  const [focusIndex, setFocusIndex] = useState(0);

  // Input guard: ignore Space/Enter for a short period after mount
  const readyRef = useRef(false);
  useEffect(() => {
    readyRef.current = false;
    const timer = setTimeout(() => { readyRef.current = true; }, INPUT_GUARD_MS);
    return () => clearTimeout(timer);
  }, []);

  const confirmSelection = useCallback((index: number) => {
    audioSystem.sfx('uiAccept');
    if (index === 0) {
      // Random: pick a random slot
      const randomSlot = slots[Math.floor(Math.random() * slots.length)];
      selectCharacter(randomSlot);
    } else {
      selectCharacter(slots[index - 1]);
    }
  }, [slots, selectCharacter]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      let newIndex = focusIndex;

      if (key === 'w' || key === 'arrowup') {
        newIndex = focusIndex - COLUMNS;
        if (newIndex < 0) newIndex = focusIndex; // clamp top
      } else if (key === 's' || key === 'arrowdown') {
        newIndex = focusIndex + COLUMNS;
        if (newIndex >= totalItems) newIndex = focusIndex; // clamp bottom
      } else if (key === 'a' || key === 'arrowleft') {
        newIndex = focusIndex - 1;
        if (newIndex < 0) newIndex = 0;
      } else if (key === 'd' || key === 'arrowright') {
        newIndex = focusIndex + 1;
        if (newIndex >= totalItems) newIndex = totalItems - 1;
      } else if (key === ' ' || key === 'enter') {
        e.preventDefault();
        if (!readyRef.current) return; // ignore carry-over from previous phase
        confirmSelection(focusIndex);
        return;
      } else {
        return;
      }

      e.preventDefault();
      if (newIndex !== focusIndex) audioSystem.sfx('uiSelect');
      setFocusIndex(newIndex);
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusIndex, totalItems, confirmSelection]);

  const renderSlot = (index: number) => {
    const isRandom = index === 0;
    const isFocused = focusIndex === index;
    const slot = isRandom ? null : slots[index - 1];
    const color = isRandom ? '#aaa' : CHARACTER_TEAM_COLORS[slot!];
    const entry = slot ? voxRoster[slot] : null;
    const icon = isRandom ? '🎲' : (HERO_ICONS[entry!.id] ?? '⚔️');
    // Strip variant suffix: "Mimic A (Purple)" → "Mimic"
    const rawName = isRandom ? 'Random' : entry!.name;
    const name = isRandom ? rawName : rawName.replace(/\s*\([^)]*\)\s*/g, '').replace(/\s+[A-H]$/i, '').trim();

    return (
      <button
        key={isRandom ? '__random__' : slot}
        onClick={() => confirmSelection(index)}
        onMouseEnter={() => { if (focusIndex !== index) { audioSystem.sfx('uiSelect'); setFocusIndex(index); } }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '10px 6px',
          background: isFocused ? 'rgba(60,60,100,0.95)' : 'rgba(20,20,40,0.9)',
          border: `2px solid ${isFocused ? '#fff' : color}`,
          borderRadius: 8,
          cursor: 'pointer',
          transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s, background 0.15s',
          transform: isFocused ? 'scale(1.06)' : 'scale(1)',
          boxShadow: isFocused ? `0 2px 16px ${color}88` : 'none',
          minWidth: 0,
          minHeight: 0,
          outline: 'none',
        }}
      >
        <div style={{ fontSize: 24, marginBottom: 4, lineHeight: 1 }}>
          {icon}
        </div>
        <div
          style={{
            width: 20,
            height: 3,
            borderRadius: 2,
            background: color,
            marginBottom: 6,
          }}
        />
        <div
          style={{
            color: isFocused ? '#fff' : 'rgba(255,255,255,0.8)',
            fontSize: 12,
            fontWeight: isFocused ? 700 : 600,
            letterSpacing: 0.5,
            textAlign: 'center',
            lineHeight: 1.2,
          }}
        >
          {name}
        </div>
      </button>
    );
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)',
        pointerEvents: 'auto',
      }}
    >
      <h2
        style={{
          color: '#fff',
          fontSize: 32,
          fontWeight: 700,
          margin: '0 0 8px',
          letterSpacing: 3,
          textShadow: '0 2px 8px rgba(0,0,0,0.5)',
          textAlign: 'center',
          width: '90%',
        }}
      >
        CHOOSE YOUR CHARACTER
      </h2>
      <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, margin: '0 0 8px' }}>
        WASD / Arrows to navigate, Space to select
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${COLUMNS}, 1fr)`,
          gap: 8,
          maxWidth: 560,
          width: '90%',
          maxHeight: '60vh',
          overflowY: 'auto',
          padding: 6,
        }}
      >
        {Array.from({ length: totalItems }, (_, i) => renderSlot(i))}
      </div>
    </div>
  );
}

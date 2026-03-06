import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '../../store';
import {
  CHARACTER_TEAM_COLORS,
  getHeroSlots,
  getMonsterSlots,
  getSlots,
  voxRoster,
  getArchetype,
} from '../character';
import { isRangedHeroId } from '../character/CharacterSettings';
import { audioSystem } from '../../utils/AudioSystem';
import { voxPreviewManager } from './VoxPreview';
import type { CharacterType } from '../character';
import type { VoxCharEntry } from '../character/VoxCharacterDB';

/** Small icon button with hover grow + highlight. Supports keyboard focus via `focused` prop. */
function IconButton({ icon, title, onClick, focused, onHover, onLeave }: {
  icon: string; title: string; onClick: () => void;
  focused?: boolean; onHover?: () => void; onLeave?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const highlight = focused || hovered;
  return (
    <button
      tabIndex={-1}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => { setHovered(true); onHover?.(); }}
      onMouseLeave={() => { setHovered(false); onLeave?.(); }}
      style={{
        background: 'none',
        border: '2px solid',
        borderColor: highlight ? '#fff' : 'rgba(255,255,255,0.5)',
        borderRadius: 4,
        color: '#fff',
        cursor: 'pointer',
        fontSize: 16,
        padding: '2px 6px',
        lineHeight: 1,
        transition: 'transform 0.15s, border-color 0.15s, box-shadow 0.15s',
        transform: highlight ? 'scale(1.25)' : 'scale(1)',
        boxShadow: highlight ? '0 0 10px rgba(255,255,255,0.4)' : 'none',
      }}
      title={title}
    >
      {icon}
    </button>
  );
}

/** Delay before accepting Space/Enter after mount */
const INPUT_GUARD_MS = 400;
const COLUMNS = 6;

/** Strip variant suffix: "Blob A (Green)" -> "Blob" */
function displayName(entry: VoxCharEntry): string {
  return entry.name
    .replace(/\s*\([^)]*\)\s*/g, '')
    .replace(/\s+[A-H]$/i, '')
    .trim();
}

// ── Live canvas hook ──
// Each card owns its own <canvas>. A small rAF loop copies from
// the manager's source canvas so React never loses track of DOM nodes.

function useVoxCanvas(entry: VoxCharEntry | null) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    let rafId = 0;

    voxPreviewManager.load(entry).then((sourceCanvas) => {
      if (cancelled) return;
      setLoaded(true);

      const copyFrame = () => {
        if (cancelled) return;
        const local = canvasRef.current;
        if (local && sourceCanvas.width > 0) {
          const ctx = local.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, local.width, local.height);
            ctx.drawImage(sourceCanvas, 0, 0);
          }
        }
        rafId = requestAnimationFrame(copyFrame);
      };
      rafId = requestAnimationFrame(copyFrame);
    });

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [entry?.id]);

  return { canvasRef, loaded };
}

// ── Component ──

export function CharacterSelect() {
  const selectCharacter = useGameStore((s) => s.selectCharacter);
  const heroSlots = getHeroSlots();
  const monsterSlots = getMonsterSlots();

  // Split heroes into melee (first row) and ranged (second row)
  const { meleeSlots, rangedSlots } = useMemo(() => {
    const melee: CharacterType[] = [];
    const ranged: CharacterType[] = [];
    for (const slot of heroSlots) {
      const entry = voxRoster[slot];
      const archetype = entry ? getArchetype(entry.name) : '';
      if (isRangedHeroId(archetype)) {
        ranged.push(slot);
      } else {
        melee.push(slot);
      }
    }
    return { meleeSlots: melee, rangedSlots: ranged };
  }, [heroSlots]);

  const allItems = useMemo(() => {
    const items: Array<
      | { type: 'hero'; slot: CharacterType }
      | { type: 'monster'; slot: CharacterType }
    > = [];
    // Melee heroes first, then ranged heroes
    for (const slot of meleeSlots) items.push({ type: 'hero', slot });
    for (const slot of rangedSlots) items.push({ type: 'hero', slot });
    for (const slot of monsterSlots) items.push({ type: 'monster', slot });
    return items;
  }, [meleeSlots, rangedSlots, monsterSlots]);

  // ── Row-aware focus ──
  // Virtual rows:
  //   'heroDice'                → single dice button
  //   meleeRow0..meleeRowN      → melee hero cards
  //   rangedRow0..rangedRowN    → ranged hero cards
  //   'monsterDice'             → single dice button
  //   monsterRow0..monsterRowN  → monster cards
  type FocusTarget = { kind: 'none' } | { kind: 'heroDice' } | { kind: 'monsterDice' } | { kind: 'card'; index: number };

  const meleeRowCount = Math.ceil(meleeSlots.length / COLUMNS);
  const rangedRowCount = Math.ceil(rangedSlots.length / COLUMNS);
  const monsterRowCount = Math.ceil(monsterSlots.length / COLUMNS);
  const heroRowCount = meleeRowCount + rangedRowCount;

  // Row layout: [heroDice, meleeRows..., rangedRows..., monsterDice, monsterRows...]
  const getRowItems = useCallback((row: number): FocusTarget[] => {
    if (row === 0) return [{ kind: 'heroDice' }];
    // Melee rows
    if (row >= 1 && row <= meleeRowCount) {
      const r = row - 1;
      const start = r * COLUMNS;
      const end = Math.min(start + COLUMNS, meleeSlots.length);
      return Array.from({ length: end - start }, (_, i) => ({ kind: 'card' as const, index: start + i }));
    }
    // Ranged rows
    if (row > meleeRowCount && row <= meleeRowCount + rangedRowCount) {
      const r = row - meleeRowCount - 1;
      const start = r * COLUMNS;
      const end = Math.min(start + COLUMNS, rangedSlots.length);
      const offset = meleeSlots.length;
      return Array.from({ length: end - start }, (_, i) => ({ kind: 'card' as const, index: offset + start + i }));
    }
    // Monster dice
    if (row === heroRowCount + 1) return [{ kind: 'monsterDice' }];
    // Monster rows
    if (row > heroRowCount + 1) {
      const r = row - heroRowCount - 2;
      const start = r * COLUMNS;
      const end = Math.min(start + COLUMNS, monsterSlots.length);
      const offset = meleeSlots.length + rangedSlots.length;
      return Array.from({ length: end - start }, (_, i) => ({ kind: 'card' as const, index: offset + start + i }));
    }
    return [];
  }, [meleeSlots.length, rangedSlots.length, monsterSlots.length, meleeRowCount, rangedRowCount, heroRowCount]);

  const totalRows = 1 + heroRowCount + 1 + monsterRowCount;

  const [focusRow, setFocusRow] = useState(1); // start on first hero row
  const [focusCol, setFocusCol] = useState(0);
  const lastColRef = useRef(0); // remember col when passing through dice rows

  const getFocusTarget = useCallback((): FocusTarget => {
    if (focusRow < 0) return { kind: 'none' };
    const row = getRowItems(focusRow);
    if (row.length === 0) return { kind: 'none' };
    const col = Math.min(focusCol, row.length - 1);
    return row[col];
  }, [focusRow, focusCol, getRowItems]);

  const focusTarget = getFocusTarget();

  // Input guard
  const readyRef = useRef(false);
  useEffect(() => {
    readyRef.current = false;
    const timer = setTimeout(() => { readyRef.current = true; }, INPUT_GUARD_MS);
    return () => clearTimeout(timer);
  }, []);

  // Cleanup previews on unmount
  useEffect(() => {
    return () => { voxPreviewManager.dispose(); };
  }, []);

  const confirmCard = useCallback(
    (index: number) => {
      audioSystem.sfx('uiAccept');
      selectCharacter(allItems[index].slot);
    },
    [allItems, selectCharacter],
  );

  const selectRandomHero = useCallback(() => {
    audioSystem.sfx('uiAccept');
    const slots = getHeroSlots();
    selectCharacter(slots[Math.floor(Math.random() * slots.length)]);
  }, [selectCharacter]);

  const selectRandomMonster = useCallback(() => {
    audioSystem.sfx('uiAccept');
    const slots = getMonsterSlots();
    selectCharacter(slots[Math.floor(Math.random() * slots.length)]);
  }, [selectCharacter]);

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      // If focus was cleared by mouse leave, restore to a sensible default on any nav key
      let newRow = focusRow < 0 ? 1 : focusRow;
      let newCol = focusCol;
      mouseActiveRef.current = false;

      if (key === 'w' || key === 'arrowup') {
        if (newRow > 0) {
          newRow--;
          const items = getRowItems(newRow);
          if (items.length === 1) {
            // Dice row — remember col for when we pass through
            lastColRef.current = focusCol;
            newCol = 0;
          } else {
            newCol = Math.min(lastColRef.current, items.length - 1);
          }
        }
      } else if (key === 's' || key === 'arrowdown') {
        if (newRow < totalRows - 1) {
          newRow++;
          const items = getRowItems(newRow);
          if (items.length === 1) {
            lastColRef.current = focusCol;
            newCol = 0;
          } else {
            newCol = Math.min(lastColRef.current, items.length - 1);
          }
        }
      } else if (key === 'a' || key === 'arrowleft') {
        const rowItems = getRowItems(focusRow);
        if (focusCol > 0 && rowItems.length > 1) {
          newCol = focusCol - 1;
          lastColRef.current = newCol;
        }
      } else if (key === 'd' || key === 'arrowright') {
        const rowItems = getRowItems(focusRow);
        if (focusCol < rowItems.length - 1 && rowItems.length > 1) {
          newCol = focusCol + 1;
          lastColRef.current = newCol;
        }
      } else if (key === ' ' || key === 'enter') {
        e.preventDefault();
        if (!readyRef.current) return;
        const target = getFocusTarget();
        if (target.kind === 'heroDice') selectRandomHero();
        else if (target.kind === 'monsterDice') selectRandomMonster();
        else if (target.kind === 'card') confirmCard(target.index);
        return;
      } else {
        return;
      }

      e.preventDefault();
      if (newRow !== focusRow || newCol !== focusCol) audioSystem.sfx('uiSelect');
      setFocusRow(newRow);
      setFocusCol(newCol);
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusRow, focusCol, totalRows, getRowItems, getFocusTarget, confirmCard, selectRandomHero, selectRandomMonster]);

  // Section offsets into allItems
  const meleeStart = 0;
  const rangedStart = meleeSlots.length;
  const monsterStart = meleeSlots.length + rangedSlots.length;

  // Helper: is a given card index focused?
  const isCardFocused = (cardIndex: number) =>
    focusTarget.kind === 'card' && focusTarget.index === cardIndex;
  // Track whether focus was set by mouse — on mouse leave, clear highlight
  const mouseActiveRef = useRef(false);
  const isHeroDiceFocused = focusTarget.kind === 'heroDice';
  const isMonsterDiceFocused = focusTarget.kind === 'monsterDice';

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.7)',
      pointerEvents: 'none',
    }}>
      <h2 style={{
        color: '#fff',
        fontSize: 34,
        fontWeight: 700,
        margin: '0 0 6px',
        letterSpacing: 4,
        textShadow: '0 2px 8px rgba(0,0,0,0.5)',
        textAlign: 'center',
        width: '90%',
      }}>
        VOXEL GAME
      </h2>
      <p style={{
        color: 'rgba(255,255,255,0.5)',
        fontSize: 12,
        margin: '0 0 10px',
      }}>
        WASD / Arrows to navigate, Space to select
      </p>

      <div style={{
        pointerEvents: 'auto',
        maxWidth: 520,
        width: '90%',
        maxHeight: '70vh',
        overflowY: 'auto',
        padding: 4,
      }}>
        {/* Hero section header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          marginBottom: 8,
        }}>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.15)' }} />
          <span style={{
            color: 'rgba(255,255,255,0.6)',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 2,
            whiteSpace: 'nowrap',
          }}>
            CHOOSE YOUR HERO
          </span>
          <IconButton
            icon="🎲" title="Random hero"
            onClick={selectRandomHero}
            focused={isHeroDiceFocused}
            onHover={() => { mouseActiveRef.current = true; setFocusRow(0); setFocusCol(0); }}
            onLeave={() => { mouseActiveRef.current = false; setFocusRow(-1); }}
          />
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.15)' }} />
        </div>

        {/* Melee heroes */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${COLUMNS}, 1fr)`,
          gap: 8,
          marginBottom: 6,
        }}>
          {meleeSlots.map((_, i) => {
            const cardIdx = meleeStart + i;
            const row = 1 + Math.floor(i / COLUMNS);
            const col = i % COLUMNS;
            return (
              <CardSlot
                key={cardIdx}
                index={cardIdx}
                item={allItems[cardIdx]}
                isFocused={isCardFocused(cardIdx)}
                onHover={() => { mouseActiveRef.current = true; setFocusRow(row); setFocusCol(col); lastColRef.current = col; }}
                onLeave={() => { mouseActiveRef.current = false; setFocusRow(-1); }}
                confirmSelection={confirmCard}
              />
            );
          })}
        </div>

        {/* Ranged heroes */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${COLUMNS}, 1fr)`,
          gap: 8,
          marginBottom: 14,
        }}>
          {rangedSlots.map((_, i) => {
            const cardIdx = rangedStart + i;
            const row = meleeRowCount + 1 + Math.floor(i / COLUMNS);
            const col = i % COLUMNS;
            return (
              <CardSlot
                key={cardIdx}
                index={cardIdx}
                item={allItems[cardIdx]}
                isFocused={isCardFocused(cardIdx)}
                onHover={() => { mouseActiveRef.current = true; setFocusRow(row); setFocusCol(col); lastColRef.current = col; }}
                onLeave={() => { mouseActiveRef.current = false; setFocusRow(-1); }}
                confirmSelection={confirmCard}
              />
            );
          })}
        </div>

        {/* Monster header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          marginBottom: 8,
        }}>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.15)' }} />
          <span style={{
            color: 'rgba(255,255,255,0.6)',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 2,
            whiteSpace: 'nowrap',
          }}>
            OR PLAY AS MONSTER
          </span>
          <IconButton
            icon="🎲" title="Random monster"
            onClick={selectRandomMonster}
            focused={isMonsterDiceFocused}
            onHover={() => { mouseActiveRef.current = true; setFocusRow(heroRowCount + 1); setFocusCol(0); }}
            onLeave={() => { mouseActiveRef.current = false; setFocusRow(-1); }}
          />
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.15)' }} />
        </div>

        {/* Monsters */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${COLUMNS}, 1fr)`,
          gap: 8,
        }}>
          {monsterSlots.map((_, i) => {
            const cardIdx = monsterStart + i;
            const row = meleeRowCount + rangedRowCount + 2 + Math.floor(i / COLUMNS);
            const col = i % COLUMNS;
            return (
              <CardSlot
                key={`m_${i}`}
                index={cardIdx}
                item={allItems[cardIdx]}
                isFocused={isCardFocused(cardIdx)}
                onHover={() => { mouseActiveRef.current = true; setFocusRow(row); setFocusCol(col); lastColRef.current = col; }}
                onLeave={() => { mouseActiveRef.current = false; setFocusRow(-1); }}
                confirmSelection={confirmCard}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Individual card (needs to be a component so it can have its own ref/hook) ──

interface CardSlotProps {
  index: number;
  item: { type: 'hero'; slot: CharacterType } | { type: 'monster'; slot: CharacterType };
  isFocused: boolean;
  onHover: () => void;
  onLeave: () => void;
  confirmSelection: (i: number) => void;
}

function CardSlot({ index, item, isFocused, onHover, onLeave, confirmSelection }: CardSlotProps) {
  const entry = voxRoster[item.slot];
  const color = CHARACTER_TEAM_COLORS[item.slot];
  const name = displayName(entry);
  const [hovered, setHovered] = useState(false);
  const highlight = isFocused || hovered;

  const { canvasRef, loaded } = useVoxCanvas(entry);

  return (
    <button
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => confirmSelection(index)}
      onMouseEnter={() => {
        setHovered(true);
        audioSystem.sfx('uiSelect');
        onHover();
      }}
      onMouseLeave={() => {
        setHovered(false);
        onLeave();
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '4px 2px',
        background: highlight ? 'rgba(0,0,0,0.95)' : 'rgba(20,20,40,0.9)',
        border: `2px solid ${highlight ? '#fff' : color}`,
        borderRadius: 8,
        cursor: 'pointer',
        transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s, background 0.15s',
        transform: highlight ? 'scale(1.06)' : 'scale(1)',
        boxShadow: highlight ? `0 2px 16px ${color}88` : 'none',
        minWidth: 0,
        minHeight: 0,
        outline: 'none',
      }}
    >
      <div style={{
        width: 42,
        height: 42,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 2,
      }}>
        {loaded && (
          <canvas
            ref={canvasRef}
            width={96}
            height={96}
            style={{ width: 42, height: 42, imageRendering: 'pixelated' }}
          />
        )}
      </div>
      <div style={{
        width: 16,
        height: 2,
        borderRadius: 2,
        background: color,
        marginBottom: 3,
      }} />
      <div style={{
        color: isFocused ? '#fff' : 'rgba(255,255,255,0.8)',
        fontSize: 9,
        fontWeight: isFocused ? 600 : 400,
        letterSpacing: 0.5,
        textAlign: 'center',
        lineHeight: 1.2,
      }}>
        {name}
      </div>
    </button>
  );
}

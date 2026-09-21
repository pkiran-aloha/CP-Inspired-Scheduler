import React from 'react'

/**
 * Cute hand-drawn SVG avatars for people (clients & staff).
 * Each critter is a self-contained flat illustration — no network assets,
 * renders crisp at any size, and stays in-iframe-safe like everything else here.
 * A person's `avatar` field selects one; when unset we deterministically hash
 * their id so every person ALWAYS has a stable, distinct face.
 */

const EYES = (x1, x2, y, r = 2.1) => (
  <>
    <circle cx={x1} cy={y} r={r} fill="#33304a" />
    <circle cx={x2} cy={y} r={r} fill="#33304a" />
    <circle cx={x1 + 0.7} cy={y - 0.7} r={0.65} fill="#fff" opacity=".9" />
    <circle cx={x2 + 0.7} cy={y - 0.7} r={0.65} fill="#fff" opacity=".9" />
  </>
)
const BLUSH = (y, spread = 8.4) => (
  <>
    <circle cx={24 - spread} cy={y} r={2.6} fill="#fb7185" opacity=".38" />
    <circle cx={24 + spread} cy={y} r={2.6} fill="#fb7185" opacity=".38" />
  </>
)
const SMILE = (y, w = 4.4) => <path d={`M${24 - w} ${y}q${w} ${w * 0.9} ${w * 2} 0`} stroke="#33304a" strokeWidth="1.5" fill="none" strokeLinecap="round" />

export const AVATARS = {
  fox: {
    label: 'Fox',
    d: (
      <>
        <path d="M9 16L6 4l11 6M39 16l3-12-11 6" fill="#f97316" />
        <path d="M9 16L6 4l11 6" fill="#ea580c" opacity=".55" />
        <circle cx="24" cy="26" r="15" fill="#fb923c" />
        <path d="M24 41c7 0 12.5-5.4 14-12-6-3.5-9.5-2-14 2-4.5-4-8-5.5-14-2 1.5 6.6 7 12 14 12z" fill="#fff7ed" />
        {EYES(17.5, 30.5, 24)}
        <path d="M21.5 31.5h5L24 34.5z" fill="#33304a" />
        {BLUSH(29)}
      </>
    ),
  },
  panda: {
    label: 'Panda',
    d: (
      <>
        <circle cx="9" cy="11" r="6" fill="#2d2a3f" />
        <circle cx="39" cy="11" r="6" fill="#2d2a3f" />
        <circle cx="24" cy="25" r="16.5" fill="#fdfdfd" stroke="#e5e3ef" strokeWidth="1" />
        <ellipse cx="16.5" cy="23" rx="4.6" ry="5.4" fill="#2d2a3f" transform="rotate(-14 16.5 23)" />
        <ellipse cx="31.5" cy="23" rx="4.6" ry="5.4" fill="#2d2a3f" transform="rotate(14 31.5 23)" />
        <circle cx="17.4" cy="22.2" r="1.7" fill="#fff" />
        <circle cx="30.6" cy="22.2" r="1.7" fill="#fff" />
        <ellipse cx="24" cy="31" rx="2.7" ry="2" fill="#2d2a3f" />
        {SMILE(34.5, 3.4)}
      </>
    ),
  },
  cat: {
    label: 'Kitty',
    d: (
      <>
        <path d="M10 18L9 4l10 8M38 18l1-14-10 8" fill="#c4b5fd" />
        <path d="M10 18L9 4l10 8z" fill="#ddd6fe" />
        <circle cx="24" cy="26" r="15" fill="#ddd6fe" />
        {EYES(17.5, 30.5, 24.5)}
        <path d="M22.6 30h2.8L24 31.6z" fill="#f472b6" />
        <path d="M8 26h6M8 30h6M34 26h6M34 30h6" stroke="#a5b4fc" strokeWidth="1.2" strokeLinecap="round" />
        {SMILE(32.5, 3.2)}
      </>
    ),
  },
  bear: {
    label: 'Teddy',
    d: (
      <>
        <circle cx="10" cy="11" r="5.5" fill="#b45309" />
        <circle cx="38" cy="11" r="5.5" fill="#b45309" />
        <circle cx="10" cy="11" r="2.6" fill="#fcd34d" />
        <circle cx="38" cy="11" r="2.6" fill="#fcd34d" />
        <circle cx="24" cy="26" r="15.5" fill="#d97706" />
        <ellipse cx="24" cy="32" rx="9" ry="6.6" fill="#fde68a" />
        {EYES(18, 30, 23.5)}
        <ellipse cx="24" cy="30" rx="3" ry="2.2" fill="#78350f" />
        {SMILE(34, 3.4)}
        {BLUSH(28.5)}
      </>
    ),
  },
  owl: {
    label: 'Owl',
    d: (
      <>
        <path d="M10 13q2-6 5-2M38 13q-2-6-5-2" fill="#a16207" />
        <ellipse cx="24" cy="26.5" rx="15.5" ry="16" fill="#a16207" />
        <ellipse cx="24" cy="31" rx="10" ry="9.5" fill="#fef3c7" />
        <circle cx="17.5" cy="23.5" r="5.4" fill="#fff" stroke="#7c5c10" strokeWidth="1.1" />
        <circle cx="30.5" cy="23.5" r="5.4" fill="#fff" stroke="#7c5c10" strokeWidth="1.1" />
        <circle cx="18" cy="23.8" r="2" fill="#33304a" />
        <circle cx="30" cy="23.8" r="2" fill="#33304a" />
        <path d="M24 26.6l-2.1 3.1h4.2z" fill="#f59e0b" />
        <path d="M14 12.5q2.5-5 4.8-1.6M34 12.5q-2.5-5-4.8-1.6" stroke="#a16207" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  penguin: {
    label: 'Penguin',
    d: (
      <>
        <ellipse cx="24" cy="26" rx="15" ry="16" fill="#334155" />
        <ellipse cx="24" cy="30" rx="9.6" ry="10.6" fill="#f8fafc" />
        <ellipse cx="17.5" cy="22" rx="3.4" ry="4" fill="#f8fafc" />
        <ellipse cx="30.5" cy="22" rx="3.4" ry="4" fill="#f8fafc" />
        <circle cx="18" cy="22.5" r="1.8" fill="#33304a" />
        <circle cx="30" cy="22.5" r="1.8" fill="#33304a" />
        <path d="M24 25l-3.1 3.4h6.2z" fill="#fb923c" />
        {BLUSH(27.5)}
      </>
    ),
  },
  frog: {
    label: 'Frog',
    d: (
      <>
        <circle cx="14" cy="13" r="5.6" fill="#4ade80" />
        <circle cx="34" cy="13" r="5.6" fill="#4ade80" />
        <circle cx="14" cy="12.6" r="3.1" fill="#fff" />
        <circle cx="34" cy="12.6" r="3.1" fill="#fff" />
        <circle cx="14.6" cy="13" r="1.6" fill="#14532d" />
        <circle cx="33.4" cy="13" r="1.6" fill="#14532d" />
        <ellipse cx="24" cy="28" rx="15" ry="13" fill="#86efac" />
        <path d="M15 30q9 7.5 18 0" stroke="#166534" strokeWidth="1.7" fill="none" strokeLinecap="round" />
        {BLUSH(27)}
        <circle cx="19" cy="23.5" r="1.5" fill="#14532d" />
        <circle cx="29" cy="23.5" r="1.5" fill="#14532d" />
      </>
    ),
  },
  bunny: {
    label: 'Bunny',
    d: (
      <>
        <ellipse cx="17" cy="11" rx="4.4" ry="10" fill="#fbcfe8" transform="rotate(-8 17 11)" />
        <ellipse cx="31" cy="11" rx="4.4" ry="10" fill="#fbcfe8" transform="rotate(8 31 11)" />
        <ellipse cx="17" cy="12" rx="2" ry="6.4" fill="#f472b6" opacity=".55" transform="rotate(-8 17 12)" />
        <ellipse cx="31" cy="12" rx="2" ry="6.4" fill="#f472b6" opacity=".55" transform="rotate(8 31 12)" />
        <circle cx="24" cy="29" r="13.5" fill="#fce7f3" />
        {EYES(18.5, 29.5, 28)}
        <path d="M22.6 32.4h2.8L24 34z" fill="#f472b6" />
        <path d="M24 34v2M24 36q-2 1.6-3.8 0M24 36q2 1.6 3.8 0" stroke="#d6a0ba" strokeWidth="1.1" fill="none" strokeLinecap="round" />
        {BLUSH(32.5)}
      </>
    ),
  },
  koala: {
    label: 'Koala',
    d: (
      <>
        <circle cx="9.5" cy="17" r="6.5" fill="#94a3b8" />
        <circle cx="38.5" cy="17" r="6.5" fill="#94a3b8" />
        <circle cx="9.5" cy="17" r="3.4" fill="#f1f5f9" />
        <circle cx="38.5" cy="17" r="3.4" fill="#f1f5f9" />
        <ellipse cx="24" cy="27" rx="14.5" ry="14" fill="#cbd5e1" />
        {EYES(17.5, 30.5, 24.5)}
        <ellipse cx="24" cy="31" rx="3.4" ry="4.6" fill="#475569" />
        {SMILE(37.5, 3)}
      </>
    ),
  },
  sloth: {
    label: 'Sloth',
    d: (
      <>
        <circle cx="24" cy="26" r="15.5" fill="#a8a29e" />
        <ellipse cx="24" cy="28" rx="10.6" ry="10" fill="#f5f0e8" />
        <path d="M15 20q3.5 2.5 4 9M33 20q-3.5 2.5-4 9" stroke="#78716c" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".7" />
        <path d="M15.5 27.5q2.6 2.2 5.2 0M27.3 27.5q2.6 2.2 5.2 0" stroke="#33304a" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <ellipse cx="24" cy="32.4" rx="2.6" ry="1.8" fill="#57534e" />
        {SMILE(35.4, 3)}
      </>
    ),
  },
  octopus: {
    label: 'Octo',
    d: (
      <>
        <path d="M8 30q0-16 16-16t16 16v5q0 3-2.6 3t-2.6-3.6q-1 4-3.8 4t-2.8-4q-1 4-4.2 4t-4.2-4q-1 4-3.8 4t-2.6-4q0 3.6-2.6 3.6T8 35z" fill="#f472b6" />
        <circle cx="24" cy="22" r="13.5" fill="#f9a8d4" />
        {EYES(18.5, 29.5, 21.5)}
        <path d="M24 26.5q-1.6 2.6 0 4.4 1.6-1.8 0-4.4" fill="#be185d" opacity=".65" />
        {BLUSH(26, 7.6)}
        <circle cx="13.5" cy="37.5" r="1.5" fill="#fdf2f8" />
        <circle cx="30.5" cy="38.2" r="1.5" fill="#fdf2f8" />
      </>
    ),
  },
  unicorn: {
    label: 'Unicorn',
    d: (
      <>
        <path d="M24 3L20.4 14h7.2z" fill="#fbbf24" />
        <path d="M21.4 10.6h5.2M22 8h4" stroke="#f59e0b" strokeWidth="1.1" />
        <path d="M9 20q-4 8 1 15 3-4 5-6z" fill="#a5b4fc" />
        <path d="M39 20q4 8-1 15-3-4-5-6z" fill="#f0abfc" />
        <circle cx="24" cy="27" r="13.5" fill="#fdf4ff" stroke="#e9d5ff" strokeWidth="1" />
        {EYES(18.5, 29.5, 26.5)}
        {BLUSH(31)}
        {SMILE(31.5, 3.2)}
      </>
    ),
  },
  robot: {
    label: 'Beep',
    d: (
      <>
        <path d="M24 8v-4" stroke="#64748b" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="24" cy="3.4" r="2.1" fill="#f472b6" />
        <rect x="8.5" y="9" width="31" height="29" rx="9" fill="#bfdbfe" stroke="#93c5fd" strokeWidth="1.2" />
        <rect x="5.4" y="19" width="3.4" height="8" rx="1.7" fill="#93c5fd" />
        <rect x="39.2" y="19" width="3.4" height="8" rx="1.7" fill="#93c5fd" />
        <rect x="14" y="17" width="7.6" height="7.6" rx="2.6" fill="#1e3a8a" />
        <rect x="28.4" y="17" width="7.6" height="7.6" rx="2.6" fill="#1e3a8a" />
        <circle cx="16.4" cy="19.6" r="1.5" fill="#93c5fd" />
        <circle cx="30.8" cy="19.6" r="1.5" fill="#93c5fd" />
        <path d="M18 31h12" stroke="#1e3a8a" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M20.5 31v-0M24 33.6h0" stroke="#1e3a8a" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M20 34.6q4 2.4 8 0" stroke="#1e3a8a" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  hedgehog: {
    label: 'Hedge',
    d: (
      <>
        <path d="M7 30L4 15l7 6 3-10 5 8 5-8 3 10 7-6-3 15z" fill="#8d6e63" />
        <ellipse cx="24" cy="30" rx="13" ry="11.5" fill="#e6d3bd" />
        <path d="M14 26q10-5 20 0" stroke="#d4bc9e" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        {EYES(19.5, 28.5, 29, 1.8)}
        <circle cx="24" cy="35.4" r="2.3" fill="#33304a" />
        {BLUSH(33, 6.8)}
      </>
    ),
  },
  sheep: {
    label: 'Sheep',
    d: (
      <>
        <circle cx="13" cy="17" r="7" fill="#fff" stroke="#b9c3d6" strokeWidth="1.7" />
        <circle cx="24" cy="12" r="7.5" fill="#fff" stroke="#b9c3d6" strokeWidth="1.7" />
        <circle cx="35" cy="17" r="7" fill="#fff" stroke="#b9c3d6" strokeWidth="1.7" />
        <circle cx="9" cy="26" r="5.5" fill="#fff" stroke="#b9c3d6" strokeWidth="1.7" />
        <circle cx="39" cy="26" r="5.5" fill="#fff" stroke="#b9c3d6" strokeWidth="1.7" />
        <ellipse cx="24" cy="29.5" rx="10.4" ry="11" fill="#b8c4d4" />
        <ellipse cx="13.5" cy="29" rx="3.4" ry="2.4" fill="#94a3b8" transform="rotate(-24 13.5 29)" />
        <ellipse cx="34.5" cy="29" rx="3.4" ry="2.4" fill="#94a3b8" transform="rotate(24 34.5 29)" />
        {EYES(20, 28, 28)}
        <path d="M22.6 33.6h2.8L24 35.4z" fill="#33304a" />
        <path d="M21 37.4q3 2 6 0" stroke="#64748b" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  dino: {
    label: 'Dino',
    d: (
      <>
        <path d="M13 12l2.5-5 2.5 5M20.5 10.5l2.5-5.5 2.5 5.5M28 12l2.5-5 2.5 5" fill="#34d399" />
        <path d="M15 8L13 12h5zM23 6.5l-2.5 4h5zM31 8l-2.5 4h5z" fill="#fbbf24" />
        <ellipse cx="24" cy="27" rx="15" ry="15" fill="#6ee7b7" />
        <path d="M11 26q3-5 8-5M37 26q-3-5-8-5" stroke="#34d399" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".6" />
        <ellipse cx="24" cy="32.5" rx="10.5" ry="6.6" fill="#d1fae5" />
        <circle cx="20.5" cy="29.5" r="1.1" fill="#065f46" />
        <circle cx="27.5" cy="29.5" r="1.1" fill="#065f46" />
        <path d="M18.5 34q5.5 3.6 11 0" stroke="#065f46" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <path d="M21.5 34.6l-.8 1.8M24 35.2v2M26.5 34.6l.8 1.8" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
        {EYES(18, 30, 23)}
        {BLUSH(28.5, 8.8)}
      </>
    ),
  },
  tiger: {
    label: 'Tiger',
    d: (
      <>
        <circle cx="10" cy="12" r="5.5" fill="#f97316" />
        <circle cx="38" cy="12" r="5.5" fill="#f97316" />
        <circle cx="10" cy="12" r="2.4" fill="#431407" opacity=".75" />
        <circle cx="38" cy="12" r="2.4" fill="#431407" opacity=".75" />
        <circle cx="24" cy="26" r="15.5" fill="#fb923c" />
        <path d="M9.5 19q5 1.5 6.5 5M38.5 19q-5 1.5-6.5 5M8 26.5h6.5M33.5 26.5H40M9.5 33q5-1 6.5-3M38.5 33q-5-1-6.5-3" stroke="#431407" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".8" />
        <ellipse cx="24" cy="31.5" rx="8.6" ry="6.4" fill="#ffedd5" />
        {EYES(18.5, 29.5, 24.5)}
        <path d="M22.4 29.6h3.2L24 31.6z" fill="#431407" />
        {SMILE(34, 3.2)}
      </>
    ),
  },
  chick: {
    label: 'Chick',
    d: (
      <>
        <path d="M24 9q-1-6 3-7-1.5 3 0 5.5z" fill="#f59e0b" />
        <circle cx="24" cy="26" r="15" fill="#fde047" />
        <ellipse cx="9.5" cy="28" rx="3.4" ry="5.6" fill="#facc15" transform="rotate(24 9.5 28)" />
        <ellipse cx="38.5" cy="28" rx="3.4" ry="5.6" fill="#facc15" transform="rotate(-24 38.5 28)" />
        {EYES(18, 30, 24)}
        <path d="M24 27.2l-3.4 3h6.8z" fill="#fb923c" />
        {BLUSH(28.5)}
      </>
    ),
  },
}

export const AVATAR_KEYS = Object.keys(AVATARS)

function hashStr(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** The avatar key for a person — explicit choice wins, else a stable per-id pick. */
export function avatarKeyFor(p) {
  if (p?.avatar && AVATARS[p.avatar]) return p.avatar
  return AVATAR_KEYS[hashStr(String(p?.id ?? p?.name ?? 'x')) % AVATAR_KEYS.length]
}

/** Render one critter. `name`/`color` are only used for the tooltip + ring. */
export function PersonAvatar({ p, size = 24, className = '', title, ...rest }) {
  const key = avatarKeyFor(p)
  const a = AVATARS[key]
  return (
    <span
      className={`pav ${className}`}
      style={{ width: size, height: size, '--pav-ring': p?.color || '#c7c9e8' }}
      title={title || `${p?.name ?? ''} · ${a.label}`}
      data-testid={rest['data-testid'] || `pav-${key}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 48 48" width="100%" height="100%" style={{ display: 'block' }}>{a.d}</svg>
    </span>
  )
}

/** A friendly random key, used by the "Surprise me" shuffle button. */
export function shuffleAvatar(exclude) {
  const pool = AVATAR_KEYS.filter((k) => k !== exclude)
  return pool[Math.floor(Math.random() * pool.length)]
}

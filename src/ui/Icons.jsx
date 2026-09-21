import React from 'react'

const wrap = (paths, { size = 16, className = '', strokeWidth = 1.8, fill = 'none' } = {}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {paths}
  </svg>
)

export const Icon = {
  chevronL: (p) => wrap(<path d="M15 18l-6-6 6-6" />, p),
  chevronR: (p) => wrap(<path d="M9 6l6 6-6 6" />, p),
  chevDown: (p) => wrap(<path d="M6 9l6 6 6-6" />, p),
  plus: (p) => wrap(<path d="M12 5v14M5 12h14" />, p),
  minus: (p) => wrap(<path d="M5 12h14" />, p),
  x: (p) => wrap(<path d="M18 6L6 18M6 6l12 12" />, p),
  cal: (p) => wrap(<><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></>, p),
  grid: (p) => wrap(<><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></>, p),
  rows: (p) => wrap(<><rect x="3" y="4.5" width="18" height="4.6" rx="1.8" /><rect x="3" y="14.9" width="18" height="4.6" rx="1.8" /></>, p),
  table: (p) => wrap(<><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M3 9.5h18M3 15h18M9.5 4v16M15 4v16" /></>, p),
  pie: (p) => wrap(<><path d="M12 3a9 9 0 109 9h-9z" /><path d="M14.8 3.4A9 9 0 0120.6 9.2h-5.8z" /></>, p),
  dashboard: (p) => wrap(<><rect x="3.5" y="3.5" width="7" height="9" rx="2" /><rect x="13.5" y="3.5" width="7" height="5.5" rx="2" /><rect x="13.5" y="11.5" width="7" height="9" rx="2" /><rect x="3.5" y="15" width="7" height="5.5" rx="2" /></>, p),
  phone: (p) => wrap(<path d="M6.6 3.5h3l1.5 4-2 1.6a12.5 12.5 0 005.8 5.8l1.6-2 4 1.5v3a2 2 0 01-2.2 2A16.4 16.4 0 014 7.7a2 2 0 012-2.2" />),
  mail: (p) => wrap(<><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M4 7l8 6 8-6" /></>, p),
  shield: (p) => wrap(<><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.1-7.5 9.5-4.3-1.4-7.5-4.9-7.5-9.5V6z" /><path d="M8.8 12l2.3 2.3 4.1-4.3" /></>, p),
  cake: (p) => wrap(<><path d="M4 21h16M4.5 13.5h15V19a2 2 0 01-2 2h-11a2 2 0 01-2-2z" /><path d="M4.5 13.5c1.8-1.7 3.5-1.7 5.2 0 1.8-1.7 3.5-1.7 5.2 0 1.8-1.7 3.5-1.7 4.6-.2M12 9v4.5M12 6.2c-1-1.4 1-2.4 0-3.7 1 1.3-.6 2.2 0 3.7z" /></>, p),
  house: (p) => wrap(<path d="M3.5 11L12 4l8.5 7M5.5 9.4V20h13V9.4M10 20v-6h4v6" />),
  badge: (p) => wrap(<><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" /><circle cx="9" cy="11.2" r="2.1" /><path d="M6.2 16c.6-1.4 1.6-2.1 2.8-2.1s2.2.7 2.8 2.1M14.5 9.5h4M14.5 13h4" /></>, p),
  heart: (p) => wrap(<path d="M12 20.5C6.5 16.8 3.5 13.7 3.5 9.9A4.4 4.4 0 0112 7.6a4.4 4.4 0 018.5 2.3c0 3.8-3 6.9-8.5 10.6z" />),
  palette: (p) => wrap(<><path d="M12 3.5a8.5 8.5 0 000 17c1.3 0 2-.8 2-1.7s-.8-1.6-.8-2.6c0-1 .8-1.7 1.9-1.7h1.6a3.8 3.8 0 003.8-3.9A8.6 8.6 0 0012 3.5z" /><circle cx="8" cy="9" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="16" cy="9.2" r="1" fill="currentColor" stroke="none" /></>, p),
  shuffle: (p) => wrap(<><path d="M3.5 6.5h3.2l9.4 11h4.4M20.5 6.5h-4.4M3.5 17.5h3.2l2.6-3M15.2 10.6l.9-1.1M15.2 13.4l.9 1.1" /><path d="M18.4 4.2l2.4 2.3-2.4 2.3M18.4 15.2l2.4 2.3-2.4 2.3" /></>, p),
  star: (p) => wrap(<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z" />),
  clock: (p) => wrap(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>, p),
  user: (p) => wrap(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" /></>, p),
  users: (p) => wrap(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c1.2-3.6 3.9-5.5 6.5-5.5s5.3 1.9 6.5 5.5" /><path d="M16 5a3.5 3.5 0 010 7M19.5 19.5c-.5-1.7-1.3-3.1-2.3-4.1" /></>, p),
  team: (p) => wrap(<><circle cx="6" cy="8" r="3" /><circle cx="18" cy="8" r="3" /><path d="M1.5 20c.9-2.8 2.7-4.5 4.5-4.5s3.6 1.7 4.5 4.5M13.5 20c.9-2.8 2.7-4.5 4.5-4.5s3.6 1.7 4.5 4.5" /></>, p),
  search: (p) => wrap(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></>, p),
  pin: (p) => wrap(<><path d="M12 21s-7-6.2-7-11a7 7 0 1114 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>, p),
  check: (p) => wrap(<path d="M4.5 12.5l5 5 10-11" />, p),
  checkCircle: (p) => wrap(<><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.8 2.8L16.5 9" /></>, p),
  alert: (p) => wrap(<><path d="M12 3l9.5 17H2.5L12 3z" /><path d="M12 10v4.5" /><circle cx="12" cy="18" r="0.4" fill="currentColor" /></>, p),
  trash: (p) => wrap(<><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /><path d="M10 11v6M14 11v6" /></>, p),
  edit: (p) => wrap(<><path d="M4 20h4L19.5 8.5a2.1 2.1 0 00-3-3L5 17v3z" /><path d="M14 6.5l3.5 3.5" /></>, p),
  copy: (p) => wrap(<><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M15 5.5A2.5 2.5 0 0012.5 3h-7A2.5 2.5 0 003 5.5v7A2.5 2.5 0 005.5 15" /></>, p),
  file: (p) => wrap(<><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" /><path d="M14 3v5h5" /></>, p),
  dollar: (p) => wrap(<><path d="M12 2.5v19" /><path d="M16.5 6.5c-1-1.5-2.6-2-4.5-2-2.6 0-4.5 1.5-4.5 3.6 0 4.6 9.5 2.6 9.5 7.2 0 2.1-2 3.7-4.8 3.7-2.1 0-3.9-.8-4.9-2.4" /></>, p),
  clipboard: (p) => wrap(<><rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M9 4a2 2 0 012-2h2a2 2 0 012 2" /><path d="M9 10h6M9 14h6M9 18h3.5" /></>, p),
  spark: (p) => wrap(<><path d="M12 3l1.8 4.9L18.5 9l-4.7 1.1L12 15l-1.8-4.9L5.5 9l4.7-1.1L12 3z" /><path d="M18 16l.9 2.1L21 19l-2.1.9L18 22l-.9-2.1L15 19l2.1-.9L18 16z" /></>, p),
  car: (p) => wrap(<><path d="M4 16v2.5h3V16M17 16v2.5h3V16" /><path d="M3.5 16v-3.8c0-.4.1-.8.3-1.1L5.8 7.4c.4-.8 1.2-1.4 2.1-1.4h8.2c.9 0 1.7.6 2.1 1.4l1.9 3.7c.2.3.3.7.3 1.1V16h-17z" /><path d="M7 12.5h1.5M15.5 12.5H17" /></>, p),
  cup: (p) => wrap(<><path d="M4 8h13v6a5 5 0 01-5 5H9a5 5 0 01-5-5V8z" /><path d="M17 9h1.5a2.5 2.5 0 010 5H17M4 3.5c.8.8.8 1.7 0 2.5M8 3.5c.8.8.8 1.7 0 2.5M12 3.5c.8.8.8 1.7 0 2.5" /></>, p),
  ban: (p) => wrap(<><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>, p),
  eye: (p) => wrap(<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>, p),
  moon: (p) => wrap(<path d="M20.5 14.3A8.7 8.7 0 119.7 3.5a7.2 7.2 0 0010.8 10.8z" />, p),
  sun: (p) => wrap(<><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4L19 19M19 5l-1.6 1.6M6.6 17.4L5 19" /></>, p),
  filter: (p) => wrap(<path d="M3.5 5.5h17l-6.8 7.4v6l-3.4-2v-4L3.5 5.5z" />, p),
  info: (p) => wrap(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><circle cx="12" cy="7.8" r="0.4" fill="currentColor" /></>, p),
  dots: (p) => wrap(<><circle cx="5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="19" cy="12" r="1.4" fill="currentColor" /></>, p),
  download: (p) => wrap(<><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" /><path d="M4.5 19.5h15" /></>, p),
  repeat: (p) => wrap(<><path d="M17 2.5L21 6.5l-4 4" /><path d="M3 11.5V10a4 4 0 014-4h14M7 21.5l-4-4 4-4" /><path d="M21 12.5V14a4 4 0 01-4 4H3" /></>, p),
  print: (p) => wrap(<><path d="M7 8V3.5h10V8" /><rect x="4" y="8" width="16" height="8" rx="2" /><path d="M7 13.5h10v7H7z" /></>, p),
  drag: (p) => wrap(<><circle cx="9" cy="6" r="1.3" fill="currentColor" /><circle cx="15" cy="6" r="1.3" fill="currentColor" /><circle cx="9" cy="12" r="1.3" fill="currentColor" /><circle cx="15" cy="12" r="1.3" fill="currentColor" /><circle cx="9" cy="18" r="1.3" fill="currentColor" /><circle cx="15" cy="18" r="1.3" fill="currentColor" /></>, p),
  undo: (p) => wrap(<><path d="M8 4L3.5 8.5 8 13" /><path d="M3.5 8.5H14.5a6 6 0 010 12h-6" /></>, p),
  more: (p) => wrap(<path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="2.8" strokeLinecap="round" />, p),
  grip: (p) => wrap(<path d="M9 5.5v.01M15 5.5v.01M9 12v.01M15 12v.01M9 18.5v.01M15 18.5v.01" strokeWidth="2.6" strokeLinecap="round" />, p),
  zap: (p) => wrap(<path d="M13 2.5L4.5 13.5H11L10 21.5l9-11.5h-6.5l0.5-7.5z" />, p),
  expand: (p) => wrap(<path d="M9 21H3.5V15.5M15 3h5.5V8.5M21 9v6M9 21H3M9 3H3.5V8.5M15 21h5.5V15.5" />, p),
}

export const TypeGlyph = ({ type, size = 16 }) => {
  const key = { service: 'spark', drive: 'car', break: 'cup', unavailable: 'ban', evaluation: 'clipboard', supervision: 'eye' }[type] || 'spark'
  return Icon[key]({ size })
}

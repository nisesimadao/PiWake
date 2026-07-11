// Curated Japanese fonts, loaded straight from Google Fonts (embed only —
// nothing is bundled or self-hosted; the browser caches the woff2 subsets).
export const FONT_OPTIONS = [
  { id: 'm-plus-1', label: 'M PLUS 1', family: 'M PLUS 1', google: 'M+PLUS+1:wght@400;500;700', baseWeight: 500 },
  { id: 'm-plus-rounded', label: 'M PLUS Rounded 1c', family: 'M PLUS Rounded 1c', google: 'M+PLUS+Rounded+1c:wght@400;500;700', baseWeight: 500 },
  { id: 'noto-sans-jp', label: 'Noto Sans JP', family: 'Noto Sans JP', google: 'Noto+Sans+JP:wght@400;500;700', baseWeight: 400 },
  { id: 'zen-kaku', label: 'Zen Kaku Gothic New', family: 'Zen Kaku Gothic New', google: 'Zen+Kaku+Gothic+New:wght@400;500;700', baseWeight: 400 },
  { id: 'biz-udpgothic', label: 'BIZ UDPGothic', family: 'BIZ UDPGothic', google: 'BIZ+UDPGothic:wght@400;700', baseWeight: 400 },
  { id: 'ibm-plex-jp', label: 'IBM Plex Sans JP', family: 'IBM Plex Sans JP', google: 'IBM+Plex+Sans+JP:wght@400;500;700', baseWeight: 400 },
  { id: 'zen-maru', label: 'Zen Maru Gothic', family: 'Zen Maru Gothic', google: 'Zen+Maru+Gothic:wght@400;500;700', baseWeight: 400 },
  { id: 'dotgothic16', label: 'DotGothic16', family: 'DotGothic16', google: 'DotGothic16', baseWeight: 400 },
];

const STORAGE_KEY = 'piwake.font.v1';
const DEFAULT_ID = 'm-plus-1';
const FALLBACK_STACK = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif';

function findOption(id) {
  return FONT_OPTIONS.find(option => option.id === id) || FONT_OPTIONS[0];
}

export function getFontId() {
  try { return findOption(localStorage.getItem(STORAGE_KEY) || DEFAULT_ID).id; }
  catch { return DEFAULT_ID; }
}

function ensureLink(id, href) {
  let link = document.getElementById(id);
  if (!link) {
    link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  if (link.href !== href) link.href = href;
}

function applyFont(option) {
  ensureLink('piwake-font', `https://fonts.googleapis.com/css2?family=${option.google}&display=swap`);
  const root = document.documentElement;
  root.style.setProperty('--app-font', `"${option.family}", ${FALLBACK_STACK}`);
  root.style.setProperty('--app-font-weight', String(option.baseWeight));
}

export function setFont(id) {
  const option = findOption(id);
  try { localStorage.setItem(STORAGE_KEY, option.id); } catch { /* private browsing */ }
  applyFont(option);
  return option;
}

export function initFont() {
  applyFont(findOption(getFontId()));
}

// Loads every option in one request so the Settings picker can render each
// row in its own face. Only invoked when the picker is on screen.
export function loadFontPreviews() {
  const families = FONT_OPTIONS.map(option => `family=${option.google}`).join('&');
  ensureLink('piwake-font-preview', `https://fonts.googleapis.com/css2?${families}&display=swap`);
}

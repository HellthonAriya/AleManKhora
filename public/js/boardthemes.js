/* اَلِ من خورا — Board/table colour themes shared by the felt-based renderers
   (backgammon, hokm, pasur). Each renderer reads config.boardTheme and tints
   its felt/table accordingly. The wood frame, cards and pieces stay constant so
   only the surface changes. */
export const TABLE_THEMES = [
  { id: 'classic',  name: 'سبز کلاسیک', felt: '#0c5132', edge: '#063b22' },
  { id: 'midnight', name: 'نیمه‌شب',    felt: '#15294a', edge: '#0b1730' },
  { id: 'wine',     name: 'شرابی',       felt: '#48162a', edge: '#2b0c19' },
  { id: 'charcoal', name: 'زغالی',       felt: '#23272e', edge: '#14171c' },
  { id: 'ocean',    name: 'اقیانوس',    felt: '#0d3b46', edge: '#06222a' },
  { id: 'royal',    name: 'بنفش',        felt: '#2e1d52', edge: '#190f2e' },
];

export function tableTheme(id) {
  return TABLE_THEMES.find((t) => t.id === id) || TABLE_THEMES[0];
}

/* Card face/back styles for Hokm and Pasur. */
export const CARD_STYLES = [
  { id: 'classic', name: 'کلاسیک' },
  { id: 'royal',   name: 'سلطنتی' },
  { id: 'dark',    name: 'تاریک' },
];

/* Grid-game board palettes (tictactoe / gomoku / othello / dots). */
export const GRID_THEMES = {
  tictactoe: [
    { id: 'dark',  name: 'تاریک',  bg: '#11151c', grid: 'rgba(255,255,255,.16)', line: 5, frame: '#0c0f15' },
    { id: 'light', name: 'روشن',   bg: '#ede8e0', grid: 'rgba(0,0,0,.28)',       line: 4, frame: '#cec9c1' },
    { id: 'neon',  name: 'نئون',   bg: '#07001a', grid: 'rgba(180,60,255,.55)',  line: 4, frame: '#03000e' },
  ],
  gomoku: [
    { id: 'wood',  name: 'چوب',    bg: '#caa45a', grid: 'rgba(40,26,8,.55)',  line: 1.4, frame: '#8a6b30', star: 'rgba(40,26,8,.7)' },
    { id: 'slate', name: 'سلیت',   bg: '#3c4a5a', grid: 'rgba(255,255,255,.25)', line: 1.4, frame: '#2a3440', star: 'rgba(255,255,255,.35)' },
    { id: 'maple', name: 'افرا',   bg: '#b85a28', grid: 'rgba(20,8,3,.6)',    line: 1.4, frame: '#7a3a16', star: 'rgba(20,8,3,.75)' },
  ],
  othello: [
    { id: 'green',    name: 'سبز',      bg: '#1c7a48', grid: 'rgba(0,0,0,.35)',      line: 1.4, frame: '#0f4a2b' },
    { id: 'midnight', name: 'نیمه‌شب',  bg: '#12182e', grid: 'rgba(255,255,255,.2)', line: 1.4, frame: '#080d1a' },
    { id: 'ocean',    name: 'اقیانوس', bg: '#0d3b50', grid: 'rgba(255,255,255,.2)', line: 1.4, frame: '#082330' },
  ],
  dots: [
    { id: 'dark',   name: 'تاریک',  bg: '#0e1118' },
    { id: 'purple', name: 'بنفش',   bg: '#0e0b1a' },
    { id: 'ocean',  name: 'اقیانوس', bg: '#071420' },
  ],
};

export function gridTheme(gameType, id) {
  const list = GRID_THEMES[gameType] || GRID_THEMES.othello;
  return list.find((t) => t.id === id) || list[0];
}

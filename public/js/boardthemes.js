/* اَلِ من خورا — Board/table colour themes shared by the felt-based renderers
   (backgammon, hokm, pasur). Each renderer reads config.boardTheme and tints
   its felt/table accordingly. The wood frame, cards and pieces stay constant so
   only the surface changes. */
export const TABLE_THEMES = [
  { id: 'classic', name: 'سبز کلاسیک', felt: '#0c5132', edge: '#063b22' },
  { id: 'midnight', name: 'نیمه‌شب', felt: '#15294a', edge: '#0b1730' },
  { id: 'wine', name: 'شرابی', felt: '#48162a', edge: '#2b0c19' },
  { id: 'charcoal', name: 'زغالی', felt: '#23272e', edge: '#14171c' },
  { id: 'ocean', name: 'اقیانوس', felt: '#0d3b46', edge: '#06222a' },
  { id: 'royal', name: 'بنفش', felt: '#2e1d52', edge: '#190f2e' },
];

export function tableTheme(id) {
  return TABLE_THEMES.find((t) => t.id === id) || TABLE_THEMES[0];
}

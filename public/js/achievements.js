/**
 * AleManKhora — Achievements catalog
 * ==================================
 * Pure data + predicate functions shared by the server (evaluation) and the
 * client (display). Each achievement's `check(ctx)` returns true when it has
 * been earned. The server builds `ctx` after recording per-game stats.
 *
 * ctx = {
 *   totalPlayed, totalWins,            // across all games
 *   gameWins,                          // { [gameType]: wins }
 *   distinctGamesWon,                  // how many game types with >=1 win
 *   winStreak,                         // current overall win streak
 *   gameType, won, draw,               // the game that just finished
 *   hokmSweep,                         // won a Hokm game with opponent on 0 tricks (کوت)
 * }
 */

const sumWins = (ctx, types) => types.reduce((n, t) => n + (ctx.gameWins[t] || 0), 0);

export const ACHIEVEMENTS = [
  { code: 'first_win',   icon: '🥇', name: 'اولین برد',        desc: 'اولین بازی‌ات را بردی.',                check: (c) => c.totalWins >= 1 },
  { code: 'played_10',   icon: '🎮', name: 'تازه‌کار',          desc: '۱۰ بازی انجام دادی.',                  check: (c) => c.totalPlayed >= 10 },
  { code: 'played_50',   icon: '🏅', name: 'کهنه‌کار',          desc: '۵۰ بازی انجام دادی.',                  check: (c) => c.totalPlayed >= 50 },
  { code: 'played_100',  icon: '💯', name: 'صدتایی',           desc: '۱۰۰ بازی انجام دادی.',                 check: (c) => c.totalPlayed >= 100 },
  { code: 'wins_25',     icon: '🏆', name: 'برنده',            desc: '۲۵ برد به دست آوردی.',                 check: (c) => c.totalWins >= 25 },
  { code: 'streak_3',    icon: '🔥', name: 'سه‌گانه',           desc: '۳ برد پشت‌سر‌هم.',                      check: (c) => c.winStreak >= 3 },
  { code: 'streak_5',    icon: '⚡', name: 'شکست‌ناپذیر',       desc: '۵ برد پشت‌سر‌هم.',                      check: (c) => c.winStreak >= 5 },
  { code: 'versatile_5', icon: '🎲', name: 'همه‌فن‌حریف',       desc: 'در ۵ بازی مختلف برنده شدی.',           check: (c) => c.distinctGamesWon >= 5 },
  { code: 'master_chess',    icon: '♛', name: 'استاد شطرنج',  desc: '۱۰ برد در شطرنج.',  check: (c) => sumWins(c, ['chess', 'chess4', 'chesszade']) >= 10 },
  { code: 'master_hokm',     icon: '🃏', name: 'استاد حکم',    desc: '۱۰ برد در حکم.',    check: (c) => sumWins(c, ['hokm']) >= 10 },
  { code: 'master_quoridor', icon: '🧱', name: 'معمار',        desc: '۱۰ برد در اَلِ‌من‌خورا.', check: (c) => sumWins(c, ['quoridor']) >= 10 },
  { code: 'hokm_kot',    icon: '👑', name: 'کوت!',            desc: 'یک دست حکم را بدون گرفتن حتی یک دست توسط حریف بردی.', check: (c) => !!c.hokmSweep },
];

export const ACHIEVEMENT_MAP = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.code, a]));

/** Return the codes newly satisfied in this context (caller filters dupes). */
export function evaluateAchievements(ctx) {
  const out = [];
  for (const a of ACHIEVEMENTS) {
    try { if (a.check(ctx)) out.push(a.code); } catch { /* ignore */ }
  }
  return out;
}

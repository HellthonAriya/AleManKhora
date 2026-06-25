/* =========================================================================
   اَلِ من خورا — Pasur (چهاربرگ) end-of-round scoring reveal.
   A pretty, animated full-screen overlay that, after each round:
     1) lays out every card each player captured,
     2) sweeps through them counting clubs (♣ خاج) → most-clubs bonus,
     3) sweeps again counting points card-by-card (آس/سرباز/۱۰ خشت/۲ خاج),
        then adds the سور bonus,
     4) shows the round totals and animates the running match score → target.
   Driven by the `roundResult` payload the engine puts in the game state.
   ========================================================================= */

const SUIT = ['♠', '♥', '♦', '♣'];
const RED = new Set([1, 2]);                 // ♥ ♦ are red
const FA = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const fa = (n) => String(n).replace(/\d/g, (d) => FA[+d]);
const RANK = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const rankLabel = (r) => RANK[r] || String(r);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Point value of a single captured card (matches the engine's scoring). */
function cardPoints(c) {
  if (c.r === 14) return 1;                   // ace
  if (c.r === 11) return 1;                   // jack
  if (c.r === 10 && c.s === 2) return 3;      // 10♦
  if (c.r === 2 && c.s === 3) return 2;       // 2♣
  return 0;
}

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
  .pr-overlay{position:fixed;inset:0;z-index:1400;display:flex;flex-direction:column;
    align-items:center;justify-content:flex-start;gap:10px;padding:18px 14px 22px;
    background:radial-gradient(120% 120% at 50% 0%,rgba(18,26,22,.92),rgba(6,10,8,.97));
    backdrop-filter:blur(7px);animation:pr-fade .35s ease both;overflow-y:auto}
  @keyframes pr-fade{from{opacity:0}to{opacity:1}}
  .pr-skip{position:absolute;top:12px;left:14px;font-size:13px;padding:6px 12px;border-radius:999px;
    background:rgba(255,255,255,.1);color:#dfe7e2;border:1px solid rgba(255,255,255,.18);cursor:pointer}
  .pr-skip:hover{background:rgba(255,255,255,.18)}
  .pr-title{color:#ffd76b;font-weight:800;font-size:clamp(20px,5vw,30px);margin-top:6px;
    text-shadow:0 2px 14px rgba(255,215,107,.35)}
  .pr-phase{color:#bfe7d0;font-size:14px;min-height:20px;letter-spacing:.3px;
    transition:opacity .3s;opacity:.9}
  .pr-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;width:100%;max-width:760px;margin-top:4px}
  .pr-col{background:rgba(255,255,255,.04);border:1px solid var(--pr-accent,#444);
    border-radius:16px;padding:12px 12px 14px;display:flex;flex-direction:column;gap:8px;
    box-shadow:0 6px 24px rgba(0,0,0,.3)}
  .pr-col.win{box-shadow:0 0 0 2px var(--pr-accent),0 8px 30px rgba(0,0,0,.4)}
  .pr-name{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .pr-name b{color:#fff;font-size:15px}
  .pr-name .dot{width:11px;height:11px;border-radius:50%;background:var(--pr-accent)}
  .pr-counters{display:flex;gap:8px;flex-wrap:wrap}
  .pr-chipc{font-size:12.5px;padding:4px 9px;border-radius:999px;background:rgba(0,0,0,.35);
    color:#e7eee9;border:1px solid rgba(255,255,255,.12);transition:transform .2s,background .2s,color .2s}
  .pr-chipc.act{background:rgba(255,215,107,.2);color:#ffe39a;border-color:#ffd76b;transform:scale(1.06)}
  .pr-chipc b{font-variant-numeric:tabular-nums}
  .pr-cards{display:flex;flex-wrap:wrap;gap:3px;min-height:34px}
  .pr-card{width:24px;height:33px;border-radius:5px;background:#fbfaf6;display:flex;
    flex-direction:column;align-items:center;justify-content:center;line-height:1;
    font-weight:700;border:1px solid rgba(0,0,0,.25);position:relative;
    transition:transform .18s,box-shadow .18s,filter .18s;opacity:0;animation:pr-in .28s ease forwards}
  @keyframes pr-in{from{opacity:0;transform:translateY(-8px) scale(.8)}to{opacity:1;transform:none}}
  .pr-card .r{font-size:11px}.pr-card .s{font-size:11px}
  .pr-card.red{color:#c8202e}.pr-card.blk{color:#14161e}
  .pr-card.dim{filter:grayscale(.5) brightness(.7)}
  .pr-card.lit{transform:translateY(-7px) scale(1.16);z-index:2}
  .pr-card.lit-club{box-shadow:0 0 0 2px #5be08c,0 6px 14px rgba(91,224,140,.5)}
  .pr-card.lit-pts{box-shadow:0 0 0 2px #ffd76b,0 6px 14px rgba(255,215,107,.55)}
  .pr-pop{position:absolute;top:-16px;left:50%;transform:translateX(-50%);font-size:12px;
    font-weight:800;color:#ffd76b;text-shadow:0 1px 6px rgba(0,0,0,.6);animation:pr-pop .7s ease forwards}
  @keyframes pr-pop{0%{opacity:0;transform:translate(-50%,4px)}25%{opacity:1}100%{opacity:0;transform:translate(-50%,-14px)}}
  .pr-badges{display:flex;gap:6px;flex-wrap:wrap;min-height:24px}
  .pr-badge{font-size:12px;padding:3px 9px;border-radius:999px;font-weight:700;
    background:rgba(255,215,107,.16);color:#ffe39a;border:1px solid #ffd76b;
    opacity:0;transform:scale(.6);animation:pr-badge .4s ease forwards}
  @keyframes pr-badge{to{opacity:1;transform:none}}
  .pr-total{margin-top:2px;font-size:15px;color:#fff;display:flex;align-items:baseline;
    justify-content:space-between;gap:8px}
  .pr-total .big{font-size:26px;font-weight:800;color:#ffd76b;font-variant-numeric:tabular-nums}
  .pr-match{width:100%;max-width:760px;margin-top:6px;display:flex;flex-direction:column;gap:8px}
  .pr-bar{position:relative;height:14px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden}
  .pr-bar > i{position:absolute;inset:0 auto 0 0;border-radius:999px;width:0;
    transition:width 1.1s cubic-bezier(.2,.8,.2,1)}
  .pr-matchrow{display:flex;align-items:center;justify-content:space-between;font-size:13.5px;color:#dfe7e2}
  .pr-matchrow b{font-size:17px;color:#fff;font-variant-numeric:tabular-nums}
  .pr-go{margin-top:8px;padding:12px 26px;border-radius:14px;border:none;cursor:pointer;
    font-size:16px;font-weight:800;color:#06231a;background:linear-gradient(180deg,#76e6a6,#46c97f);
    box-shadow:0 8px 24px rgba(70,201,127,.4);opacity:0;transform:translateY(8px);
    animation:pr-go .45s ease .05s forwards}
  @keyframes pr-go{to{opacity:1;transform:none}}
  .pr-go:active{transform:scale(.97)}
  @media(max-width:520px){.pr-card{width:21px;height:29px}.pr-card .r,.pr-card .s{font-size:10px}}
  `;
  const el = document.createElement('style');
  el.id = 'pasur-reveal-styles';
  el.textContent = css;
  document.head.appendChild(el);
}

/**
 * Show the animated reveal.
 * @param {object} rr roundResult from the engine
 * @param {object} opts { mySeat, names:[2], colors:[2], finalResult, target, onDone }
 * @returns {{ close:()=>void }}
 */
export function showPasurReveal(rr, opts = {}) {
  injectStyles();
  const { mySeat = 0, names = ['تو', 'حریف'], colors = ['#e7503a', '#3d7fe0'],
          finalResult = false, onDone } = opts;
  const target = rr.target || 62;
  const order = mySeat === 1 ? [1, 0] : [0, 1];   // keep "me" on the left

  const overlay = document.createElement('div');
  overlay.className = 'pr-overlay';
  const cancel = { v: false };
  let finished = false;

  const skip = document.createElement('button');
  skip.className = 'pr-skip';
  skip.textContent = 'رد کردن ⏭';
  overlay.appendChild(skip);

  const title = document.createElement('div');
  title.className = 'pr-title';
  title.textContent = `پایان دست ${fa(rr.roundNumber)}`;
  overlay.appendChild(title);

  const phase = document.createElement('div');
  phase.className = 'pr-phase';
  phase.textContent = 'کارت‌های برداشته‌شده…';
  overlay.appendChild(phase);

  const grid = document.createElement('div');
  grid.className = 'pr-grid';
  overlay.appendChild(grid);

  // Build a column per player.
  const cols = {};
  for (const seat of order) {
    const bd = rr.breakdown[seat];
    const col = document.createElement('div');
    col.className = 'pr-col';
    col.style.setProperty('--pr-accent', colors[seat] || '#888');

    const nameRow = document.createElement('div');
    nameRow.className = 'pr-name';
    nameRow.innerHTML = `<b>${seat === mySeat ? 'تو' : (names[seat] || 'حریف')}</b>`;
    const dot = document.createElement('span'); dot.className = 'dot';
    nameRow.appendChild(dot);
    col.appendChild(nameRow);

    const counters = document.createElement('div');
    counters.className = 'pr-counters';
    const cClub = document.createElement('span'); cClub.className = 'pr-chipc';
    cClub.innerHTML = `♣ خاج: <b>۰</b>`;
    const cPts = document.createElement('span'); cPts.className = 'pr-chipc';
    cPts.innerHTML = `★ امتیاز: <b>۰</b>`;
    const cCards = document.createElement('span'); cCards.className = 'pr-chipc';
    cCards.innerHTML = `🃏 ${fa(bd.cards)} برگ`;
    counters.append(cClub, cPts, cCards);
    col.appendChild(counters);

    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'pr-cards';
    // Sort: clubs first, then by rank — counting reads cleanly.
    const pile = [...rr.captured[seat]].sort((a, b) => (b.s === 3) - (a.s === 3) || a.s - b.s || b.r - a.r);
    const chips = pile.map((c, i) => {
      const d = document.createElement('div');
      d.className = 'pr-card ' + (RED.has(c.s) ? 'red' : 'blk');
      d.style.animationDelay = (i * 24) + 'ms';   // cards arrive one by one
      d.innerHTML = `<span class="r">${rankLabel(c.r)}</span><span class="s">${SUIT[c.s]}</span>`;
      d._card = c;
      cardsWrap.appendChild(d);
      return d;
    });
    col.appendChild(cardsWrap);

    const badges = document.createElement('div');
    badges.className = 'pr-badges';
    col.appendChild(badges);

    const totalRow = document.createElement('div');
    totalRow.className = 'pr-total';
    totalRow.innerHTML = `<span>امتیاز این دست</span><span class="big">۰</span>`;
    col.appendChild(totalRow);

    grid.appendChild(col);
    cols[seat] = { col, cClub, cPts, cCards, chips, badges, total: totalRow.querySelector('.big'),
                   clubN: 0, ptsN: 0, runTotal: 0 };
  }

  // Running match-score bar.
  const matchBox = document.createElement('div');
  matchBox.className = 'pr-match';
  const barRows = {};
  for (const seat of order) {
    const row = document.createElement('div');
    row.className = 'pr-matchrow';
    const nm = seat === mySeat ? 'تو' : (names[seat] || 'حریف');
    row.innerHTML = `<span>${nm} — مجموع مسابقه (هدف ${fa(target)})</span><b>۰</b>`;
    const bar = document.createElement('div'); bar.className = 'pr-bar';
    const fill = document.createElement('i'); fill.style.background = colors[seat] || '#888';
    bar.appendChild(fill);
    matchBox.append(row, bar);
    barRows[seat] = { num: row.querySelector('b'), fill };
  }
  overlay.appendChild(matchBox);

  const goBtn = document.createElement('button');
  goBtn.className = 'pr-go';
  goBtn.style.display = 'none';
  goBtn.textContent = finalResult ? 'دیدن نتیجهٔ نهایی ▶' : 'دست بعد ▶';
  overlay.appendChild(goBtn);

  document.body.appendChild(overlay);

  const finish = () => {
    if (finished) return;
    finished = true;
    cancel.v = true;
    try { overlay.remove(); } catch {}
    onDone?.();
  };
  // Tear the overlay down WITHOUT firing onDone (used on view unmount).
  const dismiss = () => { finished = true; cancel.v = true; try { overlay.remove(); } catch {} };
  goBtn.addEventListener('click', finish);

  // Skip → jump straight to the fully-counted final state.
  skip.addEventListener('click', () => { cancel.v = true; renderFinal(); });

  function setNum(el, n) { el.querySelector('b') ? el.querySelector('b').textContent = fa(n) : el.textContent = fa(n); }

  function renderFinal() {
    // Snap every counter/badge/total to its end value and show the button.
    for (const seat of order) {
      const c = cols[seat], bd = rr.breakdown[seat];
      c.cClub.querySelector('b').textContent = fa(bd.clubs);
      c.cPts.querySelector('b').textContent = fa(bd.aces + bd.jacks + bd.tenD * 3 + bd.twoC * 2);
      c.chips.forEach((ch) => ch.classList.remove('lit', 'lit-club', 'lit-pts', 'dim'));
      c.badges.innerHTML = '';
      addBadges(seat);
      c.total.textContent = fa(bd.total);
      if (rr.roundScores[seat] >= rr.roundScores[1 - seat] && rr.roundScores[seat] > 0) c.col.classList.add('win');
    }
    phase.textContent = finalResult ? 'پایان مسابقه' : 'امتیازها شمرده شد';
    animateMatch();
    goBtn.style.display = '';
  }

  function addBadges(seat) {
    const bd = rr.breakdown[seat], box = cols[seat].badges;
    box.innerHTML = '';
    const add = (txt) => { const b = document.createElement('span'); b.className = 'pr-badge'; b.textContent = txt; box.appendChild(b); };
    if (bd.surs > 0) add(`سور ×${fa(bd.surs)} = +${fa(bd.surs * 5)}`);
    if (bd.mostClubs) add('بیشترین خاج +۷');
    if (bd.tenD) add('۱۰ خشت +۳');
    if (bd.twoC) add('۲ خاج +۲');
  }

  function animateMatch() {
    for (const seat of order) {
      const after = rr.matchAfter[seat];
      barRows[seat].num.textContent = fa(after);
      barRows[seat].fill.style.width = Math.min(100, (after / target) * 100) + '%';
    }
  }

  /* ── The timeline ─────────────────────────────────────────────────────── */
  (async () => {
    await sleep(650);                                    // let cards deal in
    if (cancel.v) return;

    // Phase 1 — count clubs.
    phase.textContent = '♣ شمردن خاج‌ها…';
    for (const seat of order) cols[seat].cClub.classList.add('act');
    const maxLen = Math.max(...order.map((s) => cols[s].chips.length));
    for (let i = 0; i < maxLen; i++) {
      if (cancel.v) return;
      for (const seat of order) {
        const c = cols[seat], ch = c.chips[i];
        if (!ch) continue;
        ch.classList.add('lit');
        if (ch._card.s === 3) {
          ch.classList.add('lit-club');
          c.clubN++;
          c.cClub.querySelector('b').textContent = fa(c.clubN);
          popUp(ch, '♣');
        }
      }
      await sleep(70);
      for (const seat of order) cols[seat].chips[i]?.classList.remove('lit');
    }
    for (const seat of order) cols[seat].cClub.classList.remove('act');
    // Most-clubs verdict.
    phase.textContent = '… بیشترین خاج؟';
    await sleep(500);
    for (const seat of order) {
      if (cancel.v) return;
      if (rr.breakdown[seat].mostClubs) {
        const b = document.createElement('span'); b.className = 'pr-badge';
        b.textContent = `۷+ خاج! بیشترین خاج +۷`;
        cols[seat].badges.appendChild(b);
      }
    }
    await sleep(700);
    if (cancel.v) return;

    // Phase 2 — count points card-by-card.
    phase.textContent = '★ شمردن امتیازها…';
    for (const seat of order) cols[seat].cPts.classList.add('act');
    for (let i = 0; i < maxLen; i++) {
      if (cancel.v) return;
      for (const seat of order) {
        const c = cols[seat], ch = c.chips[i];
        if (!ch) continue;
        const p = cardPoints(ch._card);
        ch.classList.add('lit');
        if (p > 0) {
          ch.classList.add('lit-pts');
          c.ptsN += p; c.runTotal += p;
          c.cPts.querySelector('b').textContent = fa(c.ptsN);
          c.total.textContent = fa(c.runTotal);
          popUp(ch, '+' + fa(p));
        }
      }
      await sleep(90);
      for (const seat of order) cols[seat].chips[i]?.classList.remove('lit', 'lit-pts');
    }
    for (const seat of order) cols[seat].cPts.classList.remove('act');
    await sleep(350);

    // Bonuses fly in (surs + majorities), totals climb to the round score.
    phase.textContent = '➕ پاداش‌ها (سور و اکثریت)';
    for (const seat of order) {
      if (cancel.v) return;
      addBadges(seat);
      const c = cols[seat];
      const end = rr.roundScores[seat];
      // climb the round total from points-only up to the full score
      await climb(c.total, c.runTotal, end, 520, cancel);
      c.runTotal = end;
    }
    await sleep(400);
    if (cancel.v) return;

    // Highlight the round winner, then roll up the match score.
    for (const seat of order) {
      if (rr.roundScores[seat] >= rr.roundScores[1 - seat] && rr.roundScores[seat] > 0) cols[seat].col.classList.add('win');
    }
    phase.textContent = finalResult ? '🏁 مجموع نهایی مسابقه' : 'مجموع مسابقه';
    await sleep(250);
    animateMatch();
    await sleep(950);
    if (cancel.v) return;
    goBtn.style.display = '';
  })();

  function popUp(chip, txt) {
    const p = document.createElement('span'); p.className = 'pr-pop'; p.textContent = txt;
    chip.appendChild(p);
    setTimeout(() => { try { p.remove(); } catch {} }, 720);
  }
  async function climb(el, from, to, dur, cancelTok) {
    if (to <= from) { el.textContent = fa(to); return; }
    const steps = to - from, per = Math.max(40, dur / steps);
    for (let v = from + 1; v <= to; v++) {
      if (cancelTok.v) { el.textContent = fa(to); return; }
      el.textContent = fa(v);
      await sleep(per);
    }
  }

  return { close: finish, dismiss };
}

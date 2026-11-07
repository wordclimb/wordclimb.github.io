// Word Climb Daily on the web — the app's Daily, same puzzle and same rules, no install.
// Rules mirror the game: DailyPuzzleService (which puzzle), GameStateManager (moves, mistakes,
// free typos, detours), PathScoring + BalanceConfig (grades), DailyStreakRules (streak) and
// ShareCardBuilder (the share card). Progress lives in this browser only (localStorage).
(() => {
  'use strict';

  // Where the "more climbs" card points. live: false recruits closed-test testers (pre-launch);
  // live: true (public on Google Play since the 2026-11 launch) links the store page.
  const APP = {
    live: true,
    store: 'https://play.google.com/store/apps/details?id=com.garnergames.starladder',
    testers: 'https://groups.google.com/g/wordclimbtesters',
    optIn: 'https://play.google.com/apps/testing/com.garnergames.starladder',
  };
  // The app is Android only: iPhones and iPads get the "more climbs" text without a store button.
  const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const SITE = 'wordclimb.github.io/daily';
  const EPOCH = Date.UTC(2025, 0, 1);                     // DailyPuzzleService.Epoch
  const MISTAKES = 3;                                     // BalanceConfig.DailyMistakeBudget
  const PERFECT_MAX_DETOURS = 0, GOOD_MAX_DETOURS = 2;    // BalanceConfig
  const GRADES = ['Failed', 'Solved', 'Good', 'Perfect']; // PathGrade, value = stars
  const OK = 0, DETOUR = 1, MISTAKE = 2;

  // ── today's puzzle ───────────────────────────────────────────────────
  const pad = n => String(n).padStart(2, '0');
  const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const daysSinceEpoch = d =>
    Math.max(0, Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 86400000));

  const pool = atob(window.WC_DATA.pool).split(';').map(line => {
    const [start, goal, par] = line.split(' ');
    return { start, goal, par: Number(par) };
  });
  const now = new Date();
  const today = isoOf(now);
  const index = daysSinceEpoch(now) % pool.length;
  const puzzle = pool[index];
  const number = index + 1;
  const len = puzzle.start.length;
  const words = new Set(window.WC_DATA.words[len].split(' '));
  document.documentElement.style.setProperty('--len', String(Math.max(len, 5)));  // tiles fit 6-7 letters

  // One-letter neighbours by wildcard buckets, and every word's distance to the goal (one BFS).
  const buckets = new Map();
  const keyAt = (w, i) => w.slice(0, i) + '_' + w.slice(i + 1);
  for (const w of words) for (let i = 0; i < len; i++) {
    const k = keyAt(w, i);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(w);
  }
  const neighbours = w => {
    const out = [];
    for (let i = 0; i < len; i++) for (const n of buckets.get(keyAt(w, i)) || []) if (n !== w) out.push(n);
    return out;
  };
  const dist = new Map([[puzzle.goal, 0]]);
  for (let queue = [puzzle.goal], h = 0; h < queue.length; h++) {
    const w = queue[h];
    for (const n of neighbours(w)) if (!dist.has(n)) { dist.set(n, dist.get(w) + 1); queue.push(n); }
  }
  const distanceToGoal = w => (dist.has(w) ? dist.get(w) : Infinity);
  const oneLetterApart = (a, b) => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 1) return false;
    return diff === 1;
  };
  const changedAt = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i; return -1; };

  // ── state (saved per day, so a refresh never loses a climb) ──────────
  const load = (k, fallback) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: play on */ } };
  const DAY_KEY = 'wc.daily.' + today, STREAK_KEY = 'wc.streak';

  let s = load(DAY_KEY, null);
  if (!s || s.start !== puzzle.start || s.goal !== puzzle.goal) {
    s = { start: puzzle.start, goal: puzzle.goal, chain: [puzzle.start], moves: [], hint: -1, hintUsed: false, done: false, failed: false };
  }
  let input = '';
  const count = c => s.moves.filter(m => m === c).length;
  const mistakesLeft = () => MISTAKES - count(MISTAKE);
  const tail = () => s.chain[s.chain.length - 1];
  const persist = () => save(DAY_KEY, s);

  // ── rules ────────────────────────────────────────────────────────────
  function submit() {
    if (s.done) return;
    if (input.length < len) { say(`Word must be ${len} letters`, 'bad'); shake(); return; }
    const word = input, prev = tail();
    input = '';
    if (!words.has(word)) {
      // A real-shaped typo (one letter changed, just not a word) bounces free; anything else costs.
      if (oneLetterApart(prev, word)) { say('Not a word — free try', 'bad'); shake(word); render(); return; }
      return mistake('Change exactly one letter', word);
    }
    if (s.chain.includes(word)) return mistake('Already used', word);
    if (!oneLetterApart(prev, word)) return mistake('Change exactly one letter', word);

    s.moves.push(distanceToGoal(word) < distanceToGoal(prev) ? OK : DETOUR);
    s.chain.push(word);
    s.hint = -1;
    if (word === puzzle.goal) { finish(false); return; }
    say('Nice!', 'good');
    persist();
    render(true);
  }

  function mistake(reason, word) {
    s.moves.push(MISTAKE);
    say(reason, 'bad');
    shake(word);
    if (mistakesLeft() <= 0) { finish(true); return; }
    persist();
    render();
  }

  function undo() {
    if (s.done || s.chain.length <= 1) return;
    s.chain.pop();
    for (let i = s.moves.length - 1; i >= 0; i--) if (s.moves[i] !== MISTAKE) { s.moves.splice(i, 1); break; }
    s.hint = -1;
    input = '';
    say('');
    persist();
    render();
  }

  // The hint marks the letter of the best next step from where the player IS: an unplayed word
  // one letter away, as close to the goal as the dictionary allows (the app's off-path rule).
  function nextStep() {
    let best = null, bestD = Infinity;
    for (const n of neighbours(tail())) {
      if (s.chain.includes(n)) continue;
      const d = distanceToGoal(n);
      if (d < bestD || (d === bestD && n < best)) { best = n; bestD = d; }
    }
    return best;
  }

  function hint() {
    if (s.done || s.hintUsed) return;
    const step = nextStep();
    if (!step) { say('No step left from here — try Undo', 'bad'); return; }
    s.hint = changedAt(tail(), step);
    s.hintUsed = true;
    say('Change the marked letter', 'good');
    persist();
    render();
  }

  function grade() {
    const detours = count(DETOUR);
    let g = s.failed ? 0 : detours <= PERFECT_MAX_DETOURS ? 3 : detours <= GOOD_MAX_DETOURS ? 2 : 1;
    if (s.hintUsed && !s.failed && g > 2) g = 2;              // assisted caps at Good
    return g;
  }

  function finish(failed) {
    s.done = true;
    s.failed = failed;
    s.hint = -1;
    input = '';
    persist();
    recordPlayed();
    say(failed ? 'Out of mistakes' : 'Climbed it!', failed ? 'bad' : 'good');
    render(true);
    setTimeout(openResults, failed ? 700 : 900);
  }

  // A played day (solved or failed) keeps the streak; a missed day starts it again.
  function yesterdayIso() { const y = new Date(now); y.setDate(y.getDate() - 1); return isoOf(y); }
  function recordPlayed() {
    const st = load(STREAK_KEY, { current: 0, best: 0, last: null });
    if (st.last === today) return;
    st.current = st.last === yesterdayIso() ? Math.max(1, st.current + 1) : 1;
    st.best = Math.max(st.best, st.current);
    st.last = today;
    save(STREAK_KEY, st);
  }
  function streak() {
    const st = load(STREAK_KEY, { current: 0, best: 0, last: null });
    const alive = st.last === today || st.last === yesterdayIso();
    return { current: alive ? st.current : 0, best: st.best };
  }

  // The ladder grid, the app's exact text (ShareCardBuilder.BuildDailyShapeCard): one row per move, a
  // square per letter with the changed one lit (a refused word is a full ⬛ row), read bottom-up like
  // the board. Shape only: which letter changed, never the letters.
  function shareText() {
    const g = s.failed ? 0 : grade();
    const score = s.failed ? 'X' : String(s.chain.length - 1);
    const st = streak();
    const badge = '⭐'.repeat(g) + (s.hintUsed ? '⚡' : '');
    const rows = [];
    let k = 0;
    for (const m of s.moves) {
      if (m === MISTAKE) { rows.push('⬛'.repeat(len)); continue; }
      const a = s.chain[k], b = s.chain[k + 1];
      k++;
      let row = '';
      for (let i = 0; i < len; i++) row += a && b && a[i] !== b[i] ? (m === DETOUR ? '🟨' : '🟩') : '⬜';
      rows.push(row);
    }
    const lines = [`Word Climb #${number} ${badge ? badge + ' ' : ''}${score}/${puzzle.par}`, ...rows.reverse()];
    if (st.current > 0) lines.push(`🔥 ${st.current}`);
    lines.push(SITE);
    return lines.join('\n');
  }

  // ── view ─────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function tileRow(word, cls, opts = {}) {
    const row = el('div', 'row ' + (opts.rowCls || ''));
    row.setAttribute('aria-label', word ? word.toUpperCase() : 'Your word');
    for (let i = 0; i < len; i++) {
      const t = el('div', 'tile ' + cls, word ? word[i] || '' : '');
      if (i === opts.changed) t.classList.add('changed');
      row.appendChild(t);
    }
    return row;
  }

  function render(newRow) {
    const board = $('board');
    board.textContent = '';
    board.appendChild(el('span', 'tag goal-tag', 'GOAL'));
    board.appendChild(el('span', 'tag start-tag', 'START'));
    const solved = s.done && !s.failed;
    const chain = s.chain;

    if (solved) {
      board.appendChild(tileRow(puzzle.goal, 'goal', { changed: changedAt(chain[chain.length - 2], puzzle.goal), rowCls: newRow ? 'new' : '' }));
    } else {
      board.appendChild(tileRow(puzzle.goal, 'goal'));
    }
    if (!s.done) {
      const row = el('div', 'row input');
      row.id = 'inputRow';
      row.setAttribute('aria-label', input ? `Typing ${input.toUpperCase()}` : 'Type a word');
      for (let i = 0; i < len; i++) {
        const t = el('div', 'tile empty', input[i] || '');
        if (i === s.hint) t.classList.add('hint');
        else if (i === input.length) t.classList.add('caret');
        row.appendChild(t);
      }
      board.appendChild(row);
    }
    const last = solved ? chain.length - 2 : chain.length - 1;
    for (let i = last; i >= 1; i--) {
      board.appendChild(tileRow(chain[i], 'rung', { changed: changedAt(chain[i - 1], chain[i]), rowCls: newRow && i === last && !solved ? 'new' : '' }));
    }
    board.appendChild(tileRow(chain[0], 'start', { rowCls: 'ground' }));

    const left = mistakesLeft();
    $('hud').innerHTML = `Par ${puzzle.par} · <span class="${left <= 1 ? 'low' : 'left'}">Mistakes left: ${left}</span>`;
    $('hintBtn').disabled = s.done || s.hintUsed;
    $('hintBadge').textContent = s.hintUsed ? '0' : '1';
    $('undoBtn').disabled = s.done || s.chain.length <= 1;
    $('resultsBtn').classList.toggle('hidden', !s.done);
    $('appBtn').classList.toggle('hidden', !s.done || !APP.live || IOS);
    $('hintBtn').classList.toggle('hidden', s.done);
    $('undoBtn').classList.toggle('hidden', s.done);
    for (const k of document.querySelectorAll('.key')) k.disabled = s.done;
    $('boardWrap').scrollTop = 0;
  }

  function typed(letter) {
    if (s.done || input.length >= len) return;
    input += letter;
    say('');
    render();
    const tiles = document.querySelectorAll('#inputRow .tile');
    tiles[input.length - 1]?.classList.add('pop');
  }
  function backspace() { if (s.done || !input) return; input = input.slice(0, -1); render(); }

  function say(text, tone) { const m = $('message'); m.textContent = text; m.className = 'message ' + (tone || ''); }
  function shake(word) {
    // A refused word stays on the row, red, through its shake (as in the app), then clears.
    const row = $('inputRow');
    if (!row) return;
    if (word) [...row.children].forEach((t, i) => { t.textContent = word[i] || ''; });
    row.classList.add('bad', 'shake');
    setTimeout(() => render(), 450);
  }

  function buildKeyboard() {
    const kb = $('keyboard');
    const rows = ['qwertyuiop', 'asdfghjkl', '<zxcvbnm>'];
    for (const r of rows) {
      const row = el('div', 'krow');
      for (const ch of r) {
        let key;
        if (ch === '<') { key = el('button', 'key wide del', 'DEL'); key.onclick = backspace; key.setAttribute('aria-label', 'Delete'); }
        else if (ch === '>') { key = el('button', 'key wide go', 'GO'); key.onclick = submit; key.setAttribute('aria-label', 'Submit'); }
        else { key = el('button', 'key', ch.toUpperCase()); key.onclick = () => typed(ch); }
        row.appendChild(key);
      }
      kb.appendChild(row);
    }
  }

  // ── results ──────────────────────────────────────────────────────────
  function openResults() {
    const g = grade();
    const steps = s.chain.length - 1;
    const st = streak();
    $('resultsDay').textContent = `Daily #${number}${s.hintUsed ? ' · assisted' : ''}`;
    $('gradeLabel').textContent = GRADES[g];
    $('starsLabel').textContent = '★'.repeat(g) + '☆'.repeat(3 - g);
    $('routeLabel').textContent = `${puzzle.start} → ${puzzle.goal}`;
    $('heroCard').classList.toggle('failed', s.failed);
    $('parFact').textContent = `${puzzle.par} → ${s.failed ? 'X' : steps}`;
    $('parNote').textContent = s.failed ? 'out of mistakes' : steps === puzzle.par ? 'matched par' : `${steps - puzzle.par} over par`;
    $('streakFact').textContent = `${st.current} ${st.current === 1 ? 'day' : 'days'}`;
    $('bestNote').textContent = `Best ${st.best} · Calendar ›`;
    const path = $('pathRows');
    path.textContent = '';
    for (const m of s.moves) path.appendChild(el('span', 'dot c' + m));
    path.setAttribute('aria-label', `${count(OK)} optimal, ${count(DETOUR)} detours, ${count(MISTAKE)} mistakes`);
    $('cta').innerHTML = APP.live && IOS
      ? `<p><b>Want another climb now?</b> There's one Daily a day. The Word Climb app has 700 more puzzles, but it's only on Android for now.</p>`
      : APP.live
      ? `<p><b>Want another climb now?</b> There's one Daily a day. The Word Climb app has 700 more puzzles, endless Classic ladders and Timed runs.</p>
         <a class="btn" href="${APP.store}">Get the app on Google Play</a>`
      : `<p><b>Want more climbs?</b> The Word Climb app has endless Classic ladders, the Puzzle Library and Timed runs. It's in early testing on Android.</p>
         <a class="btn" href="${APP.testers}" target="_blank" rel="noopener">Join the testers</a>
         <p class="fine">After joining, tap “Become a tester” on <a href="${APP.optIn}" target="_blank" rel="noopener">this page</a> to install it.</p>`;
    tickCountdown();
    $('resultsModal').classList.remove('hidden');
  }

  function tickCountdown() {
    const t = new Date();
    const midnight = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
    const mins = Math.max(0, Math.ceil((midnight - t) / 60000));
    $('nextLabel').textContent = `Next climb in ${Math.floor(mins / 60)}h ${pad(mins % 60)}m`;
  }

  async function share() {
    const text = shareText();
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.share) {
      try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); flashShare('Copied — paste it anywhere'); }
    catch { window.prompt('Copy your result:', text); }
  }
  function flashShare(text) {
    const b = $('shareBtn'), was = b.textContent;
    b.textContent = text;
    setTimeout(() => { b.textContent = was; }, 1800);
  }

  // ── calendar ─────────────────────────────────────────────────────────
  // Every day this browser played is already saved under its own wc.daily.<date> key (never deleted),
  // so the calendar reads those: solved, tried (failed, or left unfinished), or missed since the first climb.
  const DAY_PREFIX = 'wc.daily.';
  const DAY_LABELS = { solved: 'solved', failed: 'tried, not solved', missed: 'missed', today: 'today', before: '', future: '' };
  let calView = new Date(now.getFullYear(), now.getMonth(), 1);

  function playedDays() {
    const days = new Map();
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const iso = k && k.startsWith(DAY_PREFIX) ? k.slice(DAY_PREFIX.length) : '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
        const d = load(k, null);
        if (d) days.set(iso, d.done ? (d.failed ? 'failed' : 'solved') : 'open');
      }
    } catch { /* storage blocked: an empty calendar */ }
    return days;
  }

  function dayStatus(iso, days, first) {
    const st = days.get(iso);
    if (st === 'solved') return 'solved';
    if (iso === today) return st === 'failed' ? 'failed' : 'today';
    if (iso > today) return 'future';
    if (st) return 'failed';
    return first && iso > first ? 'missed' : 'before';
  }

  function renderCalendar() {
    const days = playedDays();
    const first = [...days.keys()].sort()[0] || null;
    let solved = 0, notSolved = 0;
    if (first) {
      const [fy, fm, fd] = first.split('-').map(Number);
      for (let d = new Date(fy, fm - 1, fd); isoOf(d) <= today; d.setDate(d.getDate() + 1)) {
        const st = dayStatus(isoOf(d), days, first);
        if (st === 'solved') solved++;
        else if (st === 'failed' || st === 'missed') notSolved++;
      }
    }
    const st = streak();
    $('calStreak').textContent = `${st.current} ${st.current === 1 ? 'day' : 'days'}`;
    $('calBest').textContent = `Best ${st.best}`;
    $('calSolved').textContent = String(solved);
    $('calMissed').textContent = String(notSolved);

    const y = calView.getFullYear(), m = calView.getMonth();
    $('calMonth').textContent = calView.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const grid = $('calGrid');
    grid.textContent = '';
    for (const d of ['M', 'T', 'W', 'T', 'F', 'S', 'S']) grid.appendChild(el('span', 'dow', d));
    for (let i = (new Date(y, m, 1).getDay() + 6) % 7; i > 0; i--) grid.appendChild(el('span', 'day'));
    for (let d = 1, n = new Date(y, m + 1, 0).getDate(); d <= n; d++) {
      const iso = `${y}-${pad(m + 1)}-${pad(d)}`;
      const status = dayStatus(iso, days, first);
      const cell = el('span', `day ${status}${iso === today ? ' now' : ''}`, String(d));
      if (DAY_LABELS[status]) cell.setAttribute('aria-label', `${iso}: ${DAY_LABELS[status]}`);
      grid.appendChild(cell);
    }
    const shown = `${y}-${pad(m + 1)}`;
    $('calPrev').disabled = shown <= (first || today).slice(0, 7);
    $('calNext').disabled = shown >= today.slice(0, 7);
  }

  function openCalendar() {
    calView = new Date(now.getFullYear(), now.getMonth(), 1);
    renderCalendar();
    $('calModal').classList.remove('hidden');
  }
  function shiftMonth(by) { calView = new Date(calView.getFullYear(), calView.getMonth() + by, 1); renderCalendar(); }

  // ── wiring ───────────────────────────────────────────────────────────
  const MODALS = ['helpModal', 'resultsModal', 'calModal'];
  const modalOpen = () => MODALS.some(id => !$(id).classList.contains('hidden'));
  function closeModals() { for (const id of MODALS) $(id).classList.add('hidden'); }

  $('dayLabel').innerHTML = `<span class="long">Daily </span>#${number}`;
  $('calBtn').onclick = openCalendar;
  $('streakTile').onclick = openCalendar;
  $('calClose').onclick = () => $('calModal').classList.add('hidden');
  $('calPrev').onclick = () => shiftMonth(-1);
  $('calNext').onclick = () => shiftMonth(1);
  $('hintBtn').onclick = hint;
  $('undoBtn').onclick = undo;
  $('resultsBtn').onclick = openResults;
  $('appBtn').href = APP.store;
  $('helpBtn').onclick = () => $('helpModal').classList.remove('hidden');
  $('helpClose').onclick = () => { $('helpModal').classList.add('hidden'); save('wc.seenHelp', true); };
  $('resultsClose').onclick = () => $('resultsModal').classList.add('hidden');
  $('shareBtn').onclick = share;
  for (const m of MODALS.map($)) m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); });

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (modalOpen()) { if (e.key === 'Escape') closeModals(); return; }
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (e.key === 'Backspace') { e.preventDefault(); backspace(); }
    else if (/^[a-zA-Z]$/.test(e.key)) typed(e.key.toLowerCase());
  });
  // Left open past midnight: the next visit starts the new day's climb.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && isoOf(new Date()) !== today) location.reload(); });
  setInterval(() => { if (!$('resultsModal').classList.contains('hidden')) tickCountdown(); }, 30000);

  buildKeyboard();
  render();
  if (s.done) openResults();
  else if (!load('wc.seenHelp', false)) $('helpModal').classList.remove('hidden');
})();

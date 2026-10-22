/* GlitchBox — UI rendering
 * The Chamber component (one playable puzzle room bound to one player) plus
 * renderers for the side panels, route map, comparison board, completion
 * screen and session report. State changes go through GB.game; this file only draws.
 */
(function (GB) {
  'use strict';

  const E = GB.engine;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pad = E.pad;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let uid = 0;

  function clock(ms) {
    const s = Math.floor((ms || 0) / 1000);
    return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  }
  function human(ms) {
    if (ms == null) return '—';
    const s = Math.max(1, Math.round(ms / 1000));
    return s >= 60 ? `${Math.floor(s / 60)}m ${pad(s % 60)}s` : `${s}s`;
  }
  function pct(x) {
    return x == null ? '—' : `${Math.round(x * 100)}%`;
  }
  function branchName(b) {
    return b ? E.BRANCH_NAMES[b] || 'Shared start' : 'Not chosen yet';
  }
  function pips(n) {
    return `<span class="pips" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
  }

  // =====================================================================
  // Chamber — one playable room
  // =====================================================================
  class Chamber {
    constructor(root, player, opts) {
      this.root = root;
      this.player = player;
      this.opts = Object.assign({ compact: false, readOnly: false, manageFocus: true, finishLabel: 'OPEN THE CORE →' }, opts);
      this.id = 'c' + ++uid;
      this.busy = false;
      this.render();
      this.timer = setInterval(() => this.tick(), 1000);
    }

    get puzzle() {
      return GB.game.puzzleOf(this.player);
    }

    destroy() {
      clearInterval(this.timer);
      clearTimeout(this.skipTimer);
      this.root.innerHTML = '';
    }

    emit(type, data) {
      if (this.opts.onChange) this.opts.onChange(type, data);
    }

    // ---------- full render for the current puzzle ----------
    render() {
      const p = this.puzzle;
      const pl = this.player;
      const st = pl.current;
      this.renderedHints = 0;
      const branch = pl.branch || 'shared';
      this.root.innerHTML = `
        <article class="chamber${this.opts.compact ? ' is-compact' : ''}${this.opts.readOnly ? ' is-sim' : ''}" data-branch="${branch}" aria-labelledby="${this.id}-title">
          <div class="chamber-meta">
            <span class="room-no mono">ROOM <b>${pad(pl.roomIndex + 1)}</b> / ${pad(E.TOTAL_ROOMS)}</span>
            <span class="badge badge-cat">${esc(p.category)}</span>
            <span class="diff mono" title="Challenge level ${p.difficulty} of 5"><span class="sr-only">Challenge level ${p.difficulty} of 5</span>LVL ${pips(p.difficulty)}</span>
            <span class="badge badge-branch" data-branch="${branch}">${branch === 'shared' ? 'Shared start' : esc(branchName(branch))}</span>
          </div>
          <h2 class="chamber-title" id="${this.id}-title" tabindex="-1">${esc(p.title)}</h2>
          <p class="chamber-brief">${esc(p.brief)}</p>
          <div class="puzzle-stage" data-stage>${p.render()}</div>
          <form class="answer" novalidate data-form>
            ${this.controlsHTML(p)}
            <div class="answer-actions">
              <button type="submit" class="btn btn-primary" data-submit>Submit</button>
              <button type="button" class="btn btn-ghost" data-hint>Hint <span class="mono hint-level" data-hint-level></span></button>
              <button type="button" class="btn btn-ghost btn-skip" data-skip>Skip room</button>
            </div>
          </form>
          <div class="feedback" data-feedback role="status" aria-live="polite"></div>
          <div class="solved" data-solved hidden></div>
          <div class="hint-log" data-hints aria-live="polite"></div>
          <footer class="chamber-foot mono">
            <span>ATTEMPTS <b data-attempts>0</b></span>
            <span>HINTS <b data-hintcount>0</b></span>
            <span>TIME <b data-time>00:00</b></span>
            <span class="room-dots" aria-hidden="true">${Array.from({ length: E.TOTAL_ROOMS }, (_, i) => `<i class="${i < pl.history.length ? (pl.history[i].skipped ? 'skipped' : 'done') : i === pl.roomIndex ? 'now' : ''}"></i>`).join('')}</span>
          </footer>
        </article>`;
      this.el = this.root.querySelector('.chamber');
      this.q = (s) => this.el.querySelector(s);
      this.bind();
      this.refresh();
      if (st.solved) this.showSolved(pl.history[pl.history.length - 1], pl.pending, true);
    }

    controlsHTML(p) {
      const id = `${this.id}-in`;
      const ro = this.opts.readOnly ? ' readonly tabindex="-1"' : '';
      if (p.interaction === 'number' || p.interaction === 'text') {
        const numeric = p.interaction === 'number' || /digit/.test(p.inputHint || '');
        return `<div class="field"><label class="field-label mono" for="${id}">Your answer${p.inputHint ? ` · ${esc(p.inputHint)}` : ''}</label>
          <input id="${id}" class="answer-input mono" data-input type="text" ${numeric ? 'inputmode="numeric"' : 'autocapitalize="characters"'} autocomplete="off" spellcheck="false" maxlength="12" placeholder="${numeric ? '_ _' : 'TYPE HERE'}"${ro}></div>`;
      }
      if (p.interaction === 'choice') {
        return `<fieldset class="options${p.options[0].html.includes('blocks') ? ' is-visual' : ''}"><legend class="field-label mono">Choose one</legend>
          ${p.options.map((o) => `<label class="option"><input type="radio" name="${id}" value="${o.id}" aria-label="${esc(o.label)}"${this.opts.readOnly ? ' tabindex="-1"' : ''}><span class="option-body">${o.html}</span></label>`).join('')}</fieldset>`;
      }
      if (p.interaction === 'order') {
        return `<div class="order"><p class="field-label mono" id="${id}-l">Tap agents in entry order · tap a slot to remove</p>
          <ol class="order-slots" aria-labelledby="${id}-l">${p.tokens.map((_, i) => `<li><button type="button" class="slot" data-slot="${i}" aria-label="Slot ${i + 1}, empty"><small>${i + 1}</small><span></span></button></li>`).join('')}</ol>
          <div class="order-tokens">${p.tokens.map((t) => `<button type="button" class="token" data-token="${esc(t)}">${esc(t)}</button>`).join('')}
          <button type="button" class="btn btn-ghost btn-sm" data-clear>Clear</button></div></div>`;
      }
      return '';
    }

    bind() {
      this.q('[data-form]').addEventListener('submit', (e) => {
        e.preventDefault();
        if (!this.opts.readOnly) this.handleSubmit();
      });
      this.q('[data-hint]').addEventListener('click', () => {
        if (!this.opts.readOnly) this.handleHint();
      });
      this.q('[data-skip]').addEventListener('click', () => {
        if (!this.opts.readOnly) this.handleSkip();
      });
      if (this.puzzle.interaction === 'order') {
        this.order = [];
        this.el.querySelectorAll('[data-token]').forEach((b) => b.addEventListener('click', () => this.placeToken(b.dataset.token)));
        this.el.querySelectorAll('[data-slot]').forEach((b) => b.addEventListener('click', () => this.removeSlot(+b.dataset.slot)));
        this.q('[data-clear]').addEventListener('click', () => {
          this.order = [];
          this.drawOrder();
        });
      }
    }

    // ---------- ordering interaction ----------
    placeToken(t) {
      if (this.player.current.solved || this.order.includes(t) || this.order.length >= this.puzzle.tokens.length) return;
      this.order.push(t);
      this.drawOrder();
    }
    removeSlot(i) {
      if (this.player.current.solved || i >= this.order.length) return;
      this.order.splice(i, 1);
      this.drawOrder();
    }
    drawOrder() {
      this.el.querySelectorAll('[data-slot]').forEach((b, i) => {
        const v = this.order[i];
        b.querySelector('span').textContent = v || '';
        b.classList.toggle('filled', !!v);
        b.setAttribute('aria-label', `Slot ${i + 1}, ${v || 'empty'}`);
      });
      this.el.querySelectorAll('[data-token]').forEach((b) => {
        const used = this.order.includes(b.dataset.token);
        b.disabled = used;
        b.setAttribute('aria-pressed', used);
      });
    }

    readInput() {
      const p = this.puzzle;
      if (p.interaction === 'choice') {
        const c = this.el.querySelector('input[type=radio]:checked');
        return c ? c.value : '';
      }
      if (p.interaction === 'order') return this.order.slice();
      return this.q('[data-input]').value;
    }

    // ---------- actions ----------
    handleSubmit() {
      if (this.busy || this.player.current.solved) return;
      this.disarmSkip();
      const res = GB.game.submit(this.player, this.readInput());
      const fb = this.q('[data-feedback]');
      if (res.status === 'ignored') return;
      if (res.status === 'invalid' || res.status === 'repeat') {
        this.feedback('warn', res.message);
        this.focusInput();
        return;
      }
      if (res.status === 'wrong') {
        this.feedback('err', `<b>Attempt ${this.player.current.wrong} rejected.</b> ${res.message}`);
        this.el.classList.remove('shake');
        void this.el.offsetWidth;
        this.el.classList.add('shake');
        GB.sound && GB.sound.play('wrong');
        this.busy = true;
        setTimeout(() => (this.busy = false), 350);
        this.refresh();
        this.focusInput(true);
        this.emit('wrong', res);
        return;
      }
      // correct
      this.busy = true;
      fb.className = 'feedback is-ok';
      this.feedback('ok', `<b>Lock open.</b> ${esc(res.record.outcomeLabel)} — ${esc(res.record.outcomeReason)}`);
      this.el.classList.add('is-solved');
      GB.sound && GB.sound.play('correct');
      this.refresh();
      setTimeout(() => {
        this.busy = false;
        this.showSolved(res.record, res.decision);
      }, reducedMotion() ? 0 : 450);
      this.emit('correct', res);
    }

    handleHint() {
      if (this.player.current.solved) return;
      this.disarmSkip();
      const res = GB.game.requestHint(this.player);
      if (res.status === 'exhausted') {
        this.feedback('warn', res.message);
        return;
      }
      if (res.status !== 'hint') return;
      GB.sound && GB.sound.play('hint');
      this.refresh();
      this.emit('hint', res);
    }

    // Two-step: the first press asks for confirmation, the second skips.
    handleSkip() {
      if (this.busy || this.player.current.solved) return;
      const btn = this.q('[data-skip]');
      if (!btn.classList.contains('is-arming')) {
        btn.classList.add('is-arming');
        btn.textContent = 'Confirm skip';
        this.feedback('warn', 'Press <b>Confirm skip</b> to move on. The room counts as skipped, not solved, and its fragment stays corrupted.');
        clearTimeout(this.skipTimer);
        this.skipTimer = setTimeout(() => this.disarmSkip(), 5000);
        return;
      }
      this.disarmSkip();
      const res = GB.game.skip(this.player);
      if (res.status !== 'skipped') return;
      this.feedback('warn', `<b>Room skipped.</b> ${esc(res.record.outcomeReason)}`);
      GB.sound && GB.sound.play('next');
      this.refresh();
      this.showSolved(res.record, res.decision);
      this.emit('skip', res);
    }

    disarmSkip() {
      clearTimeout(this.skipTimer);
      const btn = this.el && this.el.querySelector('[data-skip]');
      if (!btn) return;
      btn.classList.remove('is-arming');
      btn.textContent = 'Skip room';
    }

    feedback(kind, html) {
      const fb = this.q('[data-feedback]');
      fb.className = `feedback is-${kind}`;
      fb.innerHTML = html;
    }

    focusInput(select) {
      if (!this.opts.manageFocus || this.opts.readOnly) return;
      const inp = this.q('[data-input]');
      if (inp) {
        inp.focus();
        if (select) inp.select();
      }
    }

    // ---------- incremental refresh ----------
    refresh() {
      const st = this.player.current;
      this.q('[data-attempts]').textContent = st.wrong + (st.solved && !st.skipped ? 1 : 0);
      this.q('[data-hintcount]').textContent = st.hintLog.length;
      this.q('[data-time]').textContent = clock(GB.session.elapsed(this.player));
      const hintBtn = this.q('[data-hint]');
      const next = st.solved ? null : E.nextHint(this.player);
      this.q('[data-hint-level]').textContent = st.solved ? '' : next ? `· ${E.HINT_LABELS[next.key].toUpperCase()}` : '· ALL SHOWN';
      hintBtn.disabled = !next || st.solved;
      this.q('[data-submit]').disabled = st.solved;
      this.q('[data-skip]').disabled = st.solved;
      this.el.querySelectorAll('[data-form] input, [data-form] .token, [data-form] .slot, [data-clear]').forEach((i) => {
        if (st.solved) i.disabled = true;
      });
      this.renderHints();
    }

    renderHints() {
      const st = this.player.current;
      const box = this.q('[data-hints]');
      const p = this.puzzle;
      for (let i = this.renderedHints; i < st.hintLog.length; i++) {
        const h = st.hintLog[i];
        const card = document.createElement('div');
        card.className = `hint-card is-${h.key.toLowerCase()}${h.source === 'system' ? ' is-system' : ''}`;
        const lvl = h.key === 'ALT' ? `FORMAT SWITCH · ${esc(p.alt.label.toUpperCase())}` : `LEVEL ${h.key[1]} · ${E.HINT_LABELS[h.key].toUpperCase()}`;
        const body = h.key === 'ALT' ? `<div class="alt-body">${p.alt.html()}</div>` : `<p>${p.hints[+h.key[1] - 1].text}</p>`;
        card.innerHTML = `<div class="hint-head mono"><span class="hint-tag">${lvl}</span><span class="hint-src">${h.source === 'system' ? 'offered by system' : 'requested'}</span></div>${body}<p class="hint-why mono"><span>WHY</span> ${esc(h.reason)}</p>`;
        box.prepend(card);
      }
      this.renderedHints = st.hintLog.length;
      // Highlights requested by the text hints shown so far.
      const keys = new Set();
      st.hintLog.forEach((h) => {
        if (h.key !== 'ALT') (p.hints[+h.key[1] - 1].highlight || []).forEach((k) => keys.add(k));
      });
      this.el.querySelectorAll('[data-hl]').forEach((n) => n.classList.toggle('is-hl', keys.has(n.dataset.hl)));
    }

    showSolved(rec, decision, instant) {
      const box = this.q('[data-solved]');
      const pl = this.player;
      const frag = GB.puzzles.FRAGMENTS[rec.room];
      let decisionHTML = '';
      let btn = '';
      if (decision) {
        const np = GB.puzzles.get(decision.puzzleId);
        decisionHTML = `<div class="decision"><p class="eyebrow mono">ADAPTIVE DECISION</p>
          ${decision.events.map((ev) => `<div class="decision-ev" data-type="${ev.type}"><b>${esc(ev.title)}</b><p>${esc(ev.reason)}</p></div>`).join('')}
          <p class="next-preview mono">NEXT → ROOM ${pad(decision.room + 1)} · ${esc(np.category)} · <span data-branch="${decision.branch}">${esc(branchName(decision.branch))}</span></p></div>`;
        btn = `<button type="button" class="btn btn-primary" data-next>Enter Room ${pad(decision.room + 1)} →</button>`;
      } else if (pl.status === 'complete') {
        btn = `<button type="button" class="btn btn-primary" data-finish>${esc(this.opts.finishLabel)}</button>`;
      }
      box.innerHTML = `<div class="solved-inner${instant ? '' : ' is-new'}${rec.skipped ? ' is-skipped' : ''}">
        <p class="solved-tag mono">${rec.skipped ? 'ROOM SKIPPED' : `LOCK OPEN · ${esc(rec.outcomeLabel.toUpperCase())}`}</p>
        <p class="solved-expl">${rec.skipped ? '<span class="muted">How it worked, for next time:</span> ' : ''}${esc(this.puzzle.explanation)}</p>
        ${rec.skipped ? `<p class="fragment mono">FRAGMENT ${pad(rec.room + 1)} LOST <b>“${esc(frag.replace(/[A-Z]/g, '▒'))}”</b></p>` : `<p class="fragment mono">FRAGMENT ${pad(rec.room + 1)} RECOVERED <b>“${esc(frag)}”</b></p>`}
        ${decisionHTML}${btn}</div>`;
      box.hidden = false;
      const nb = box.querySelector('[data-next]');
      if (nb) nb.addEventListener('click', () => this.next());
      const fb = box.querySelector('[data-finish]');
      if (fb) fb.addEventListener('click', () => this.opts.onComplete && this.opts.onComplete(pl));
      if (!instant && this.opts.manageFocus && !this.opts.readOnly) (nb || fb).focus({ preventScroll: true });
      if (!instant && !this.opts.readOnly) box.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }

    next() {
      if (!GB.game.advance(this.player)) return;
      GB.sound && GB.sound.play('next');
      this.render();
      this.el.classList.add('enter');
      if (this.opts.manageFocus && !this.opts.readOnly) this.q('.chamber-title').focus({ preventScroll: false });
      this.emit('advance');
    }

    tick() {
      if (!this.el || !this.el.isConnected) return;
      this.q('[data-time]').textContent = clock(GB.session.elapsed(this.player));
      if (this.opts.onTick) this.opts.onTick();
    }

    // ---------- scripted-demo drivers (use the same code paths as a person) ----------
    async typeAnswer(text, cps) {
      const inp = this.q('[data-input]');
      inp.value = '';
      for (const ch of String(text)) {
        inp.value += ch;
        await sleep(1000 / (cps || 12));
      }
      await sleep(250);
      this.handleSubmit();
    }
    async pickOption(id) {
      const r = this.el.querySelector(`input[type=radio][value="${id}"]`);
      r.checked = true;
      r.closest('.option').classList.add('is-picked');
      await sleep(450);
      this.handleSubmit();
    }
  }

  // =====================================================================
  // Route map (SVG)
  // =====================================================================
  const NODE = { x: (i) => 40 + i * 110, y: { challenge: 34, guided: 116, shared: 75 } };

  function pathSVG(player, opts) {
    const o = opts || {};
    const pos = (room, branch) => [NODE.x(room), NODE.y[room === 0 ? 'shared' : branch]];
    let lines = '';
    // every possible connection, faint
    ['guided', 'challenge'].forEach((b) => {
      const [x1, y1] = pos(0);
      const [x2, y2] = pos(1, b);
      lines += `<line class="pv-edge" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
      for (let r = 1; r < E.TOTAL_ROOMS - 1; r++) {
        ['guided', 'challenge'].forEach((b2) => {
          const [a1, c1] = pos(r, b);
          const [a2, c2] = pos(r + 1, b2);
          lines += `<line class="pv-edge${b === b2 ? '' : ' is-cross'}" x1="${a1}" y1="${c1}" x2="${a2}" y2="${c2}"/>`;
        });
      }
    });
    // the route actually taken
    const route = player.route;
    let walked = '';
    for (let i = 1; i < route.length; i++) {
      const [x1, y1] = pos(route[i - 1].room, route[i - 1].branch);
      const [x2, y2] = pos(route[i].room, route[i].branch);
      walked += `<line class="pv-walk" data-branch="${route[i].branch}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="--d:${i * 0.12}s"/>`;
    }
    const visited = new Map(route.map((r) => [`${r.room}:${r.room === 0 ? 'shared' : r.branch}`, r]));
    const curKey = `${player.roomIndex}:${player.roomIndex === 0 ? 'shared' : player.branch}`;
    let nodes = '';
    const node = (room, branch) => {
      const k = `${room}:${branch}`;
      const [x, y] = pos(room, branch);
      const v = visited.get(k);
      const rec = v && player.history.find((h) => h.room === room && (room === 0 || h.branch === branch));
      const cls = ['pv-node', v ? 'is-visited' : '', rec ? (rec.skipped ? 'is-skipped' : 'is-done') : '', k === curKey && player.status !== 'complete' ? 'is-current' : ''].join(' ');
      nodes += `<g class="${cls}" data-branch="${branch}"><circle cx="${x}" cy="${y}" r="12"/><text x="${x}" y="${y + 4}">${pad(room + 1)}</text></g>`;
    };
    node(0, 'shared');
    for (let r = 1; r < E.TOTAL_ROOMS; r++) {
      node(r, 'challenge');
      node(r, 'guided');
    }
    const label = route
      .map((r) => `Room ${r.room + 1}: ${GB.puzzles.get(r.puzzleId).title} (${r.room === 0 ? 'shared' : E.BRANCH_NAMES[r.branch]})`)
      .join('; ');
    return `<svg class="pathviz${o.small ? ' is-small' : ''}" viewBox="0 0 520 150" role="img" aria-label="Route so far. ${esc(label)}">
      <text class="pv-lane" x="150" y="12" data-branch="challenge">CHALLENGE MODE</text>
      <text class="pv-lane" x="150" y="147" data-branch="guided">GUIDED DISCOVERY</text>
      ${lines}${walked}${nodes}</svg>`;
  }

  // =====================================================================
  // Side panels
  // =====================================================================
  function rulesHTML() {
    const R = E.RULES;
    return `<details class="rules"><summary class="mono">Inspect the rules</summary><ul>
      <li>1 wrong → feedback only, try again</li>
      <li>${R.explicitClueAfterWrong} wrong → system offers a more explicit clue</li>
      <li>${R.formatSwitchAfterWrong} wrong → clue switches format (visual / steps)</li>
      <li>${R.structuredAfterRequests} hint requests before any attempt → structured clue</li>
      <li>First-try, no hints, ≤ ${R.fastSolveSeconds}s → harder next room</li>
      <li>≥ ${R.struggleWrong} wrong or ≥ ${R.struggleHints} hints → keep next room manageable</li>
      <li>Support needed → next room uses a different format for the skill</li>
      <li>${R.promoteAfterStrongStreak} fast solves in a row → Challenge Mode unlocks</li>
      <li>Challenge Mode: system clues arrive ${R.challengeClueDelay} attempt later</li>
      <li>Skipped room → treated like support needed (never counted as solved)</li>
      </ul><p class="muted small">Thresholds live in <code>js/adaptiveEngine.js → RULES</code>. They are starting points, not measures of intelligence.</p></details>`;
  }

  function renderAdaptive(container, player) {
    if (!container.querySelector('[data-live]')) {
      container.innerHTML = `<h3 class="panel-title mono"><span class="signal" aria-hidden="true"><i></i><i></i><i></i></span>ADAPTIVE SYSTEM</h3><div data-live></div>${rulesHTML()}`;
    }
    const st = player.current;
    const p = GB.game.puzzleOf(player);
    const ms = GB.session.elapsed(player);
    const s = E.liveState(player, ms);
    const lastEv = player.events.filter((e) => e.type !== 'complete').slice(-1)[0];
    container.querySelector('[data-live]').innerHTML = `
      <div class="ad-grid">
        <div class="ad-stat"><span class="k mono">ATTEMPTS</span><span class="v">${st.wrong + (st.solved ? 1 : 0)}</span></div>
        <div class="ad-stat"><span class="k mono">HINTS</span><span class="v">${st.hintsRequested}<small>${st.cluesOffered ? ` +${st.cluesOffered} sys` : ''}</small></span></div>
        <div class="ad-stat"><span class="k mono">CHALLENGE</span><span class="v">LVL ${p.difficulty}</span></div>
        <div class="ad-stat"><span class="k mono">BRANCH</span><span class="v small" data-branch="${player.branch || 'shared'}">${player.branch ? esc(E.BRANCH_NAMES[player.branch]) : 'Shared'}</span></div>
      </div>
      <div class="ad-state mono" data-code="${s.code}"><i></i>${s.code}</div>
      <p class="ad-why">${esc(s.text)}</p>
      ${lastEv ? `<div class="ad-last"><span class="k mono">LAST ADAPTATION · ROOM ${pad(lastEv.room + 1)}</span><b>${esc(lastEv.title)}</b><p>${esc(lastEv.reason)}</p></div>` : '<div class="ad-last is-empty"><span class="k mono">LAST ADAPTATION</span><p>None yet — the first decision happens when Room 01 is cleared.</p></div>'}`;
  }

  function renderProgress(container, player) {
    const s = GB.game.stats(player);
    container.innerHTML = `<h3 class="panel-title mono">PROGRESS</h3>
      <div class="prog-grid">
        <div><span class="v">${s.solved}<small>/${s.totalRooms}${s.skipped ? ` · ${s.skipped} skipped` : ''}</small></span><span class="k mono">SOLVED</span></div>
        <div><span class="v">${s.submissions}</span><span class="k mono">ATTEMPTS</span></div>
        <div><span class="v">${s.hints}</span><span class="k mono">HINTS</span></div>
        <div><span class="v">${s.streak}</span><span class="k mono">STREAK</span></div>
      </div>
      <div class="transmission mono" aria-label="Recovered transmission">${transmissionHTML(player)}</div>
      <h4 class="sub mono">PLAYSTYLE INSIGHTS</h4>
      <ul class="insights">${GB.game.insights(player).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <p class="muted small">Observations from this session only — not a label.</p>`;
  }

  // The hidden message: solved rooms decode their fragment, skipped or unplayed ones stay corrupted.
  function transmissionHTML(player) {
    return GB.puzzles.FRAGMENTS.map((f, i) => {
      const rec = player.history.find((h) => h.room === i);
      const got = rec && !rec.skipped;
      return `<span class="${got ? 'got' : rec ? 'lost' : ''}">${got ? esc(f) : f.replace(/[A-Z]/g, '▒')}</span>`;
    }).join(' ');
  }

  function renderPath(container, player, small) {
    container.innerHTML = `${small ? '' : '<h3 class="panel-title mono">ROUTE MAP</h3>'}${pathSVG(player, { small })}`;
  }

  // =====================================================================
  // Compare board
  // =====================================================================
  function roomOne(p) {
    const st = p.roomIndex === 0 ? p.current : null;
    const rec = p.history.find((h) => h.room === 0);
    if (rec) return { attempts: rec.wrong + (rec.skipped ? 0 : 1), hints: rec.hintsRequested, clues: rec.cluesOffered, time: human(rec.timeMs), read: rec.outcomeLabel, wrong: rec.wrong };
    return { attempts: st.wrong, hints: st.hintsRequested, clues: st.cluesOffered, time: 'in progress', read: '—', wrong: st.wrong };
  }

  // Room 02 for this player — already entered, or decided and waiting for "next".
  function secondRoom(p) {
    if (p.route[1]) return p.route[1];
    return p.pending && p.pending.room === 1 ? { branch: p.pending.branch, puzzleId: p.pending.puzzleId } : null;
  }

  function compareBoardHTML(a, b) {
    const r = [roomOne(a), roomOne(b)];
    const decision = (p) => {
      const ev = p.events.find((e) => e.room === 1 && /^branch/.test(e.type));
      return ev ? `<b>${esc(ev.title)}</b><span>${esc(ev.reason)}</span>` : '<span class="muted">Waiting for Room 01 to be cleared</span>';
    };
    const nextP = (p) => {
      const n = secondRoom(p);
      if (!n) return '<span class="muted">—</span>';
      const pz = GB.puzzles.get(n.puzzleId);
      return `<b>${esc(pz.title)}</b><span>${esc(pz.category)} · LVL ${pz.difficulty}</span>`;
    };
    const fmtHints = (x) => `${x.hints} requested${x.clues ? ` · ${x.clues} offered by system` : ''}`;
    const row = (k, va, vb) => `<tr><th scope="row" class="mono">${k}</th><td>${va}</td><td>${vb}</td></tr>`;
    const [na, nb] = [secondRoom(a), secondRoom(b)];
    const both = na && nb;
    const diverged = both && (na.branch !== nb.branch || na.puzzleId !== nb.puzzleId);
    const br = (p) => p.branch || (p.pending && p.pending.branch) || null;
    let verdict;
    if (diverged) verdict = '<p class="verdict is-split">Same starting point. Different minds. Different paths.</p>';
    else if (both) verdict = '<p class="verdict">Both minds took the same branch so far — paths can still split as play continues.</p>';
    else verdict = '<p class="verdict is-wait mono">Waiting for both players to clear Room 01…</p>';
    return `<h3 class="panel-title mono">SIDE-BY-SIDE</h3>
      <div class="table-wrap"><table class="cmp">
        <thead><tr><th></th><th scope="col" data-slot="A">${esc(a.name)} <small class="mono">A</small></th><th scope="col" data-slot="B">${esc(b.name)} <small class="mono">B</small></th></tr></thead>
        <tbody>
          ${row('INITIAL PUZZLE', '2, 4, 8, 16, ?', '2, 4, 8, 16, ?')}
          ${row('ROOM 01 ATTEMPTS', r[0].attempts, r[1].attempts)}
          ${row('ROOM 01 HINTS', fmtHints(r[0]), fmtHints(r[1]))}
          ${row('ROOM 01 TIME', r[0].time, r[1].time)}
          ${row('ADAPTATION', decision(a), decision(b))}
          ${row('NEXT PUZZLE', nextP(a), nextP(b))}
          ${row('BRANCH', `<span class="badge badge-branch" data-branch="${br(a) || 'shared'}">${esc(branchName(br(a)))}</span>`, `<span class="badge badge-branch" data-branch="${br(b) || 'shared'}">${esc(branchName(br(b)))}</span>`)}
          ${row('PROGRESS', `${a.history.length} / ${E.TOTAL_ROOMS} rooms`, `${b.history.length} / ${E.TOTAL_ROOMS} rooms`)}
        </tbody></table></div>${verdict}`;
  }

  function readoutHTML(player) {
    const s = E.liveState(player, GB.session.elapsed(player));
    const last = player.events.slice(-1)[0];
    return `<div class="ad-state mono" data-code="${s.code}"><i></i>${s.code}</div>
      <p class="ad-why">${esc(last ? `${last.title}: ${last.reason}` : s.text)}</p>`;
  }

  // =====================================================================
  // Completion + report
  // =====================================================================
  function eventsListHTML(player) {
    const evs = player.events;
    if (!evs.length) return '<p class="muted">No adaptation events recorded.</p>';
    return `<ol class="events">${evs
      .map((e) => `<li data-type="${e.type}"><span class="ev-room mono" title="${e.decision ? 'Decision for room' : 'During room'} ${pad(e.room + 1)}">${e.decision ? '→' : ''}R${pad(e.room + 1)}</span><div><b>${esc(e.title)}</b><p>${esc(e.reason)}</p></div></li>`)
      .join('')}</ol>`;
  }

  function routeListHTML(player) {
    return `<ol class="route-list">${player.route
      .map((r) => {
        const pz = GB.puzzles.get(r.puzzleId);
        const h = player.history.find((x) => x.room === r.room);
        return `<li><span class="mono">R${pad(r.room + 1)}</span><b>${esc(pz.title)}</b><span class="badge badge-branch" data-branch="${r.room === 0 ? 'shared' : r.branch}">${r.room === 0 ? 'Shared' : esc(E.BRANCH_NAMES[r.branch])}</span>${h ? `<small class="muted">${esc(h.outcomeLabel)}</small>` : ''}</li>`;
      })
      .join('')}</ol>`;
  }

  function completeHTML(player) {
    const s = GB.game.stats(player);
    // Skipped rooms leave their words corrupted in the final transmission.
    const words = [];
    GB.puzzles.FRAGMENTS.forEach((f, i) => {
      const rec = player.history.find((h) => h.room === i);
      f.split(' ').forEach((w) => words.push(rec && rec.skipped ? { w: w.replace(/[A-Z]/g, '▒'), lost: true } : { w }));
    });
    const title = s.skipped ? 'CASE CLOSED' : 'CASE SOLVED';
    return `<div class="complete">
      <p class="eyebrow mono">CASE ${esc(player.caseId)} · ${esc(player.name.toUpperCase())}</p>
      <h1 class="case-solved glitch" data-text="${title}" tabindex="-1">${title}</h1>
      <div class="core" aria-hidden="true"><span></span><span></span><span></span></div>
      <p class="reveal mono" aria-label="${esc(words.map((x) => (x.lost ? 'corrupted' : x.w)).join(' '))}">${words.map((x, i) => `<span style="--i:${i}"${x.lost ? ' class="lost"' : ''}>${esc(x.w)}</span>`).join(' ')}</p>
      <p class="reveal-note">${
        s.skipped
          ? `${s.skipped} skipped room${s.skipped > 1 ? 's' : ''} left part of the message corrupted. Play again to recover every fragment.`
          : 'The box was never really locked. It was listening — and it rebuilt each room around how you solved the last one.'
      }</p>
      <div class="stat-row">
        <div class="stat"><span class="v">${s.solved}<small>/${s.totalRooms}</small></span><span class="k mono">SOLVED${s.skipped ? ` · ${s.skipped} SKIPPED` : ''}</span></div>
        <div class="stat"><span class="v">${s.submissions}</span><span class="k mono">ATTEMPTS</span></div>
        <div class="stat"><span class="v">${s.hints}<small>${s.clues ? ` +${s.clues}` : ''}</small></span><span class="k mono">HINTS${s.clues ? ' + SYSTEM CLUES' : ''}</span></div>
        <div class="stat"><span class="v">${human(s.totalTimeMs)}</span><span class="k mono">SOLVING TIME</span></div>
      </div>
      <div class="complete-grid">
        <section class="panel"><h3 class="panel-title mono">YOUR ROUTE</h3>${pathSVG(player)}${routeListHTML(player)}</section>
        <section class="panel"><h3 class="panel-title mono">HOW THE BOX ADAPTED</h3>${eventsListHTML(player)}</section>
      </div>
      <div class="ctas">
        <button type="button" class="btn btn-primary" data-act="again">Play again</button>
        <button type="button" class="btn btn-ghost" data-act="compare">Compare players</button>
        <button type="button" class="btn btn-ghost" data-act="report">View session report</button>
      </div></div>`;
  }

  function reportHTML(player) {
    const s = GB.game.stats(player);
    const h = player.history;
    const needs = {};
    h.forEach((r) => {
      if (r.outcome === 'struggled' || r.skipped || r.hintsRequested > 0 || r.cluesOffered > 0) {
        needs[r.category] = (needs[r.category] || 0) + r.hintsRequested + r.cluesOffered + r.wrong;
      }
    });
    const needList = Object.entries(needs).sort((a, b) => b[1] - a[1]);
    const bars = h.length
      ? h
          .map(
            (r) => `<div class="dp-col${r.skipped ? ' is-skipped' : ''}" data-branch="${r.branch}"><span class="dp-bar" style="--h:${r.difficulty * 20}%"><b class="mono">${r.difficulty}</b></span><span class="dp-label mono">R${pad(r.room + 1)}</span><span class="dp-name">${esc(r.title)}</span></div>`
          )
          .join('')
      : '<p class="muted">No rooms cleared yet.</p>';
    return `<div class="report">
      <header class="report-head"><div><p class="eyebrow mono">SESSION REPORT · CASE ${esc(player.caseId)}</p><h1 tabindex="-1">${esc(player.name)}</h1>
        <p class="muted">${player.status === 'complete' ? (s.skipped ? 'Case closed' : 'Case solved') : `In progress — Room ${pad(player.roomIndex + 1)}`} · ${esc(player.branch ? E.BRANCH_NAMES[player.branch] : 'No branch yet')}${player.sim ? ' · <b class="sim-tag">SIMULATED DATA</b>' : ''}</p></div>
        <div class="report-actions"><button type="button" class="btn btn-ghost" data-act="back">← Back</button><button type="button" class="btn btn-primary" data-act="again">Play again</button></div></header>
      <div class="stat-row">
        <div class="stat"><span class="v">${pct(s.solved / s.totalRooms)}</span><span class="k mono">SOLVED · ${s.solved}/${s.totalRooms}${s.skipped ? ` · ${s.skipped} SKIPPED` : ''}</span></div>
        <div class="stat"><span class="v">${pct(s.accuracy)}</span><span class="k mono">ACCURACY · ${player.correctSubmissions}/${s.submissions} ANSWERS</span></div>
        <div class="stat"><span class="v">${s.hints}<small> +${s.clues}</small></span><span class="k mono">HINTS + SYSTEM CLUES</span></div>
        <div class="stat"><span class="v">${human(s.avgTimeMs)}</span><span class="k mono">AVG SOLVE TIME</span></div>
      </div>
      <div class="report-grid">
        <section class="panel"><h3 class="panel-title mono">DIFFICULTY PROGRESSION</h3><div class="dp">${bars}</div>
          <div class="legend mono"><span data-branch="shared">Shared</span><span data-branch="guided">Guided</span><span data-branch="challenge">Challenge</span></div></section>
        <section class="panel"><h3 class="panel-title mono">WHERE MORE GUIDANCE HELPED</h3>
          ${needList.length ? `<ul class="needs">${needList.map(([c]) => `<li>${esc(c)}</li>`).join('')}</ul>` : '<p class="muted">No room needed hints or extra attempts this session.</p>'}
          <h4 class="sub mono">PLAYSTYLE INSIGHTS</h4><ul class="insights">${GB.game.insights(player).map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>
        <section class="panel span-2"><h3 class="panel-title mono">ROOM BY ROOM</h3><div class="table-wrap"><table class="cmp rooms">
          <thead><tr><th>Room</th><th>Puzzle</th><th>Category</th><th>Attempts</th><th>Hints</th><th>Time</th><th>Read</th></tr></thead>
          <tbody>${h.map((r) => `<tr><td class="mono">${pad(r.room + 1)}</td><td>${esc(r.title)}</td><td>${esc(r.category)}</td><td>${r.wrong + (r.skipped ? 0 : 1)}</td><td>${r.hintsRequested}${r.cluesOffered ? ` +${r.cluesOffered}` : ''}</td><td>${human(r.timeMs)}</td><td>${esc(r.outcomeLabel)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No rooms cleared yet.</td></tr>'}</tbody></table></div></section>
        <section class="panel span-2"><h3 class="panel-title mono">ADAPTATION EVENTS</h3>${eventsListHTML(player)}</section>
      </div>
      <p class="disclaimer">These are observations about one session of play — attempts, timing and hint use. They are not a measure of intelligence, personality, or learning ability.</p>
    </div>`;
  }

  GB.ui = { Chamber, pathSVG, renderAdaptive, renderProgress, renderPath, compareBoardHTML, readoutHTML, completeHTML, reportHTML, esc, human, clock, sleep, reducedMotion };
})((globalThis.GB = globalThis.GB || {}));

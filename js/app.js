/* GlitchBox — app controller
 * Screen routing, solo and compare flows, the scripted demo, persistence hooks,
 * dialogs and sound. Rendering lives in ui.js; game rules live in game.js / adaptiveEngine.js.
 */
(function (GB) {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const S = GB.session;
  const store = S.store;
  const UI = GB.ui;

  const state = {
    screen: null,
    mode: null, // 'solo' | 'compare' | 'demo'
    solo: null,
    cmp: null, // { A, B } live compare players
    sim: null, // { A, B } simulated demo players
    chambers: {},
    demoToken: 0,
    demoRunning: false,
    reportBack: null,
  };

  // =====================================================================
  // Sound — tiny WebAudio blips, off by default
  // =====================================================================
  GB.sound = (function () {
    let ctx = null;
    let on = store.getSetting('sound', false);
    const tones = {
      correct: [[660, 0.09], [990, 0.14, 0.09]],
      wrong: [[160, 0.18, 0, 'sawtooth', 0.04]],
      hint: [[520, 0.08]],
      next: [[440, 0.07], [660, 0.07, 0.07], [880, 0.1, 0.14]],
      solved: [[523, 0.12], [659, 0.12, 0.12], [784, 0.12, 0.24], [1047, 0.3, 0.36]],
    };
    function tone(freq, dur, delay, type, vol) {
      const t = ctx.currentTime + (delay || 0);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type || 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.06, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
    return {
      get on() {
        return on;
      },
      toggle() {
        on = !on;
        store.setSetting('sound', on);
        return on;
      },
      play(kind) {
        if (!on || !tones[kind]) return;
        try {
          ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
          tones[kind].forEach((t) => tone(t[0], t[1], t[2], t[3], t[4]));
        } catch (e) {
          /* audio unavailable — ignore */
        }
      },
    };
  })();

  // =====================================================================
  // Screens + top bar
  // =====================================================================
  function show(name) {
    $$('[data-screen]').forEach((s) => (s.hidden = s.id !== 'screen-' + name));
    $('#topbar').hidden = name === 'boot';
    state.screen = name;
    window.scrollTo(0, 0);
    updateTopbar();
    const h = $(`#screen-${name} [tabindex="-1"]`);
    if (h) h.focus({ preventScroll: true });
  }

  function progressHTML(p, label) {
    const done = p.history.length;
    return `<span class="tb-prog"${label ? ` title="${UI.esc(p.name)}"` : ''}>${label ? `<b class="mono">${label}</b>` : ''}${Array.from({ length: GB.engine.TOTAL_ROOMS }, (_, i) => `<i class="${i < done ? (p.history[i].skipped ? 'done skipped' : 'done') : i === p.roomIndex && p.status !== 'complete' ? 'now' : ''}" data-branch="${p.route[i] ? (i === 0 ? 'shared' : p.route[i].branch) : ''}"></i>`).join('')}</span>`;
  }

  function updateTopbar() {
    const caseEl = $('#tb-case');
    const playerEl = $('#tb-player');
    const prog = $('#tb-progress');
    const inSolo = state.mode === 'solo' && state.solo && ['game', 'complete', 'report'].includes(state.screen);
    const inCmp = (state.mode === 'compare' || state.mode === 'demo') && state.screen === 'compare';
    if (inSolo) {
      const p = state.solo;
      caseEl.textContent = p.caseId;
      playerEl.textContent = p.name;
      prog.innerHTML = progressHTML(p) + `<span class="mono tb-count">${p.history.length}/${GB.engine.TOTAL_ROOMS}</span>`;
      prog.setAttribute('aria-label', `Session progress: ${p.history.length} of ${GB.engine.TOTAL_ROOMS} rooms cleared`);
    } else if (inCmp) {
      const pl = state.mode === 'demo' ? state.sim : state.cmp;
      caseEl.textContent = state.mode === 'demo' ? 'SIMULATION' : 'COMPARE';
      playerEl.textContent = `${pl.A.name} vs ${pl.B.name}`;
      prog.innerHTML = progressHTML(pl.A, 'A') + progressHTML(pl.B, 'B');
      prog.setAttribute('aria-label', `A: ${pl.A.history.length} rooms, B: ${pl.B.history.length} rooms cleared`);
    } else {
      caseEl.textContent = '—';
      playerEl.textContent = '';
      prog.innerHTML = '';
    }
    $('#btn-restart').hidden = !(state.screen === 'game' || state.screen === 'compare');
  }

  // Stop all chamber timers and pause their clocks.
  function destroyChambers() {
    Object.values(state.chambers).forEach((c) => {
      S.pauseClock(c.player);
      c.destroy();
    });
    state.chambers = {};
  }

  function stopDemo() {
    state.demoToken++;
    state.demoRunning = false;
  }

  function saveAll() {
    if (state.solo) store.saveSolo(state.solo);
    if (state.cmp) store.saveCompare(state.cmp.A, state.cmp.B);
  }

  // =====================================================================
  // Dialogs
  // =====================================================================
  function confirmDialog(title, body, okLabel) {
    const dlg = $('#dlg-confirm');
    if (!dlg.showModal) return Promise.resolve(window.confirm(`${title}\n\n${body}`));
    $('#confirm-title').textContent = title;
    $('#confirm-body').textContent = body;
    $('#confirm-ok').textContent = okLabel || 'Confirm';
    dlg.returnValue = '';
    dlg.showModal();
    return new Promise((resolve) => {
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    });
  }

  function openHow() {
    const d = $('#dlg-how');
    if (d.showModal) d.showModal();
    else d.setAttribute('open', '');
  }

  // =====================================================================
  // Boot
  // =====================================================================
  function boot() {
    show('boot');
    const log = $('#boot-log');
    const lines = [
      '> glitchbox kernel v0.26 ............... ok',
      '> calibrating observation matrix ....... ok',
      `> loading ${GB.puzzles.list.length} puzzle rooms ............... ok`,
      '> adaptive engine: rule-based · local · transparent',
      '> signal detected. the box is listening_',
    ];
    const hero = $('.boot-hero');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      log.textContent = lines.join('\n');
      hero.classList.add('is-ready');
    };
    if (UI.reducedMotion()) return finish();
    let i = 0;
    const step = () => {
      if (done) return;
      if (i >= lines.length) return setTimeout(finish, 250);
      log.textContent += (i ? '\n' : '') + lines[i++];
      setTimeout(step, 260);
    };
    step();
    // Any interaction skips the boot animation.
    ['keydown', 'pointerdown'].forEach((ev) => document.addEventListener(ev, finish, { once: true }));
  }

  // =====================================================================
  // Setup
  // =====================================================================
  function openSetup(mode) {
    stopDemo();
    destroyChambers();
    saveAll();
    state.mode = null;
    renderResume();
    if (mode) $(`input[name="mode"][value="${mode}"]`).checked = true;
    syncModeFields();
    const last = state.solo || store.peek().solo;
    if (last && !$('#name-solo').value) $('#name-solo').value = last.name;
    $('#setup-error').textContent = '';
    show('setup');
  }

  function renderResume() {
    const box = $('#resume-slot');
    const peek = store.peek();
    const solo = state.solo || peek.solo;
    const cmp = state.cmp || peek.compare;
    const cards = [];
    if (solo) {
      const done = solo.status === 'complete';
      cards.push(`<div class="resume-card"><div><p class="eyebrow mono">SAVED SOLO RUN · ${UI.esc(solo.caseId)}</p><b>${UI.esc(solo.name)}</b>
        <span class="muted">${done ? 'Case solved' : `Room ${GB.engine.pad(solo.roomIndex + 1)} / 05 · ${solo.history.length} cleared`}</span></div>
        <button type="button" class="btn btn-ghost" data-resume="solo">${done ? 'View report' : 'Resume'}</button></div>`);
    }
    if (cmp) {
      cards.push(`<div class="resume-card"><div><p class="eyebrow mono">SAVED COMPARISON</p><b>${UI.esc(cmp.A.name)} vs ${UI.esc(cmp.B.name)}</b>
        <span class="muted">${cmp.A.history.length} and ${cmp.B.history.length} rooms cleared</span></div>
        <button type="button" class="btn btn-ghost" data-resume="compare">Resume</button></div>`);
    }
    box.innerHTML = cards.join('');
    box.hidden = !cards.length;
    $$('[data-resume]', box).forEach((b) =>
      b.addEventListener('click', () => {
        if (b.dataset.resume === 'solo') {
          state.solo = state.solo || store.loadSolo();
          if (!state.solo) return renderResume();
          if (state.solo.status === 'complete') {
            state.mode = 'solo';
            openReport(state.solo, 'setup');
          } else openSolo();
        } else {
          state.cmp = state.cmp || store.loadCompare();
          if (state.cmp) openCompare(state.cmp, false);
        }
      })
    );
  }

  function syncModeFields() {
    const mode = $('input[name="mode"]:checked').value;
    $('#names-solo').hidden = mode !== 'solo';
    $('#names-compare').hidden = mode !== 'compare';
    $('#btn-setup-demo').hidden = mode !== 'compare';
  }

  function onSetupSubmit(e) {
    e.preventDefault();
    const mode = $('input[name="mode"]:checked').value;
    const err = $('#setup-error');
    if (mode === 'solo') {
      const name = $('#name-solo').value.trim();
      if (!name) {
        err.textContent = 'Enter a player name to start.';
        $('#name-solo').focus();
        return;
      }
      startSolo(name);
    } else {
      const a = $('#name-a').value.trim();
      const b = $('#name-b').value.trim();
      if (!a || !b) {
        err.textContent = 'Enter a name for both players.';
        (!a ? $('#name-a') : $('#name-b')).focus();
        return;
      }
      startCompare(a, b === a ? b + ' (2)' : b);
    }
  }

  // =====================================================================
  // Solo
  // =====================================================================
  function startSolo(name) {
    destroyChambers();
    state.solo = S.createPlayer({ name, slot: 'solo' });
    store.saveSolo(state.solo);
    openSolo();
  }

  function updateSoloPanels() {
    const p = state.solo;
    UI.renderAdaptive($('#solo-adaptive'), p);
    UI.renderPath($('#solo-path'), p);
    UI.renderProgress($('#solo-progress'), p);
  }

  function openSolo() {
    stopDemo();
    destroyChambers();
    state.mode = 'solo';
    const p = state.solo;
    if (p.status === 'complete') return showComplete(p);
    S.resumeClock(p);
    $('#solo-adaptive').innerHTML = '';
    state.chambers.solo = new UI.Chamber($('#solo-chamber'), p, {
      onChange: () => {
        updateSoloPanels();
        updateTopbar();
        store.saveSolo(p);
      },
      onTick: () => UI.renderAdaptive($('#solo-adaptive'), p),
      onComplete: () => showComplete(p),
    });
    updateSoloPanels();
    show('game');
    state.chambers.solo.focusInput();
  }

  // =====================================================================
  // Compare Two Minds (live + simulated)
  // =====================================================================
  function startCompare(a, b) {
    destroyChambers();
    state.cmp = { A: S.createPlayer({ name: a, slot: 'A' }), B: S.createPlayer({ name: b, slot: 'B' }) };
    store.saveCompare(state.cmp.A, state.cmp.B);
    openCompare(state.cmp, false);
  }

  function comparePlayers() {
    return state.mode === 'demo' ? state.sim : state.cmp;
  }

  function openCompare(players, sim) {
    if (!sim) stopDemo();
    destroyChambers();
    state.mode = sim ? 'demo' : 'compare';
    ['A', 'B'].forEach((slot) => {
      const col = $('#col-' + slot);
      const p = players[slot];
      S.resumeClock(p);
      col.classList.remove('is-active');
      state.chambers[slot] = new UI.Chamber($('[data-col-chamber]', col), p, {
        compact: true,
        readOnly: sim,
        manageFocus: !sim,
        finishLabel: 'Case solved — view report →',
        onChange: () => updateCompare(),
        onTick: () => ($('[data-col-readout]', col).innerHTML = UI.readoutHTML(p)),
        onComplete: (pl) => openReport(pl, 'compare'),
      });
    });
    $('#sim-banner').hidden = !sim;
    $('#demo-caption').hidden = !sim;
    $('#screen-compare').classList.toggle('is-sim', sim);
    updateDemoControls();
    updateCompare();
    setTab('A');
    show('compare');
  }

  function updateCompare() {
    const pl = comparePlayers();
    if (!pl) return;
    ['A', 'B'].forEach((slot) => {
      const p = pl[slot];
      const col = $('#col-' + slot);
      $('[data-col-name]', col).textContent = p.name;
      $('[data-col-status]', col).innerHTML = `<span class="badge badge-branch" data-branch="${p.branch || 'shared'}">${p.branch ? GB.engine.BRANCH_NAMES[p.branch] : 'Shared start'}</span><span class="mono muted">${p.status === 'complete' ? 'CASE SOLVED' : `ROOM ${GB.engine.pad(p.roomIndex + 1)}/05`}</span>`;
      col.dataset.branch = p.branch || 'shared';
      UI.renderPath($('[data-col-path]', col), p, true);
      $('[data-col-readout]', col).innerHTML = UI.readoutHTML(p);
      const tab = $(`[data-tab="${slot}"]`);
      tab.textContent = `${slot} · ${p.name}`;
    });
    $('#compare-board').innerHTML = UI.compareBoardHTML(pl.A, pl.B);
    updateTopbar();
    if (state.mode === 'compare') store.saveCompare(pl.A, pl.B);
  }

  // Small screens show one player column at a time.
  function setTab(slot) {
    $('.compare-cols').dataset.show = slot;
    $$('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === slot)));
  }

  function updateDemoControls() {
    const sim = state.mode === 'demo';
    $('#btn-demo').hidden = state.demoRunning;
    $('#btn-demo').textContent = sim ? 'Replay demo' : 'Run demo';
    $('#btn-demo-stop').hidden = !state.demoRunning;
    $('#btn-live').hidden = !sim || state.demoRunning;
  }

  function setCaption(text, i, n, slot, final) {
    const cap = $('#demo-caption');
    cap.innerHTML = `<span class="mono step">STEP ${GB.engine.pad(i)}/${GB.engine.pad(n)}</span><span class="cap-text">${UI.esc(text)}</span>`;
    cap.classList.toggle('is-final', !!final);
    cap.classList.remove('flash');
    void cap.offsetWidth;
    cap.classList.add('flash');
    ['A', 'B'].forEach((s) => $('#col-' + s).classList.toggle('is-active', s === slot));
    if (slot) setTab(slot);
  }

  async function runDemo() {
    if (state.demoRunning) return;
    const token = ++state.demoToken;
    state.demoRunning = true;
    state.sim = { A: S.createPlayer({ name: 'Player A', slot: 'A', sim: true }), B: S.createPlayer({ name: 'Player B', slot: 'B', sim: true }) };
    openCompare(state.sim, true);
    $('#demo-caption').classList.remove('is-final');
    await GB.demo.run({
      chamber: (s) => state.chambers[s],
      player: (s) => state.sim[s],
      caption: setCaption,
      sleep: (ms) => UI.sleep(UI.reducedMotion() ? Math.min(ms, 600) : ms),
      cancelled: () => token !== state.demoToken || state.mode !== 'demo',
      step: updateCompare,
    });
    if (token === state.demoToken) {
      state.demoRunning = false;
      updateDemoControls();
      updateCompare();
      $('#compare-board').scrollIntoView({ behavior: UI.reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }
  }

  // =====================================================================
  // Completion + report
  // =====================================================================
  function showComplete(p) {
    destroyChambers();
    store.saveSolo(p);
    const box = $('#screen-complete');
    box.innerHTML = UI.completeHTML(p);
    $('[data-act="again"]', box).addEventListener('click', () => startSolo(p.name));
    $('[data-act="compare"]', box).addEventListener('click', () => (state.cmp ? openCompare(state.cmp, false) : openSetup('compare')));
    $('[data-act="report"]', box).addEventListener('click', () => openReport(p, 'complete'));
    show('complete');
    GB.sound.play('solved');
  }

  function openReport(p, back) {
    if (back !== 'compare') destroyChambers();
    else {
      stopDemo();
      destroyChambers();
    }
    state.reportBack = back;
    const box = $('#screen-report');
    box.innerHTML = UI.reportHTML(p);
    $('[data-act="back"]', box).addEventListener('click', () => {
      if (back === 'complete') showComplete(p);
      else if (back === 'compare') openCompare(p.sim ? state.sim : state.cmp, !!p.sim);
      else if (back === 'game') openSolo();
      else openSetup();
    });
    $('[data-act="again"]', box).addEventListener('click', () => (p.slot === 'solo' ? startSolo(p.name) : openSetup('compare')));
    show('report');
  }

  // =====================================================================
  // Restart
  // =====================================================================
  async function restart() {
    if (state.mode === 'solo' && state.solo) {
      const ok = await confirmDialog('Restart this run?', `All progress for ${state.solo.name} — rooms, attempts and hints — will be cleared.`, 'Restart run');
      if (ok) {
        store.clearSolo();
        startSolo(state.solo.name);
      }
    } else if (state.mode === 'compare' && state.cmp) {
      const ok = await confirmDialog('Restart the comparison?', `Progress for ${state.cmp.A.name} and ${state.cmp.B.name} will be cleared. Both start again from Room 01.`, 'Restart both');
      if (ok) {
        store.clearCompare();
        startCompare(state.cmp.A.name, state.cmp.B.name);
      }
    } else if (state.mode === 'demo') {
      stopDemo();
      runDemo();
    }
  }

  // =====================================================================
  // Wiring
  // =====================================================================
  function init() {
    $('#btn-enter').addEventListener('click', () => openSetup());
    $$('[data-open-how]').forEach((b) => b.addEventListener('click', openHow));
    $('#btn-home').addEventListener('click', () => openSetup());
    $('#btn-restart').addEventListener('click', restart);
    $('#setup-form').addEventListener('submit', onSetupSubmit);
    $$('input[name="mode"]').forEach((r) => r.addEventListener('change', syncModeFields));
    $('#btn-setup-demo').addEventListener('click', runDemo);
    $('#btn-demo').addEventListener('click', runDemo);
    $('#btn-demo-stop').addEventListener('click', () => {
      stopDemo();
      updateDemoControls();
    });
    $('#btn-live').addEventListener('click', () => (state.cmp ? openCompare(state.cmp, false) : openSetup('compare')));
    $$('[data-tab]').forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));
    $('#btn-solo-report').addEventListener('click', () => openReport(state.solo, 'game'));

    const snd = $('#btn-sound');
    const syncSound = () => {
      snd.setAttribute('aria-pressed', String(GB.sound.on));
      snd.setAttribute('aria-label', GB.sound.on ? 'Sound on' : 'Sound off');
      snd.classList.toggle('is-on', GB.sound.on);
    };
    snd.addEventListener('click', () => {
      GB.sound.toggle();
      syncSound();
      GB.sound.play('hint');
    });
    syncSound();

    // Pause clocks while the tab is hidden; save on the way out.
    document.addEventListener('visibilitychange', () => {
      // Simulated players run on a scripted virtual clock, so leave them alone.
      const live = Object.values(state.chambers)
        .map((c) => c.player)
        .filter((p) => !p.sim);
      if (document.hidden) {
        live.forEach(S.pauseClock);
        saveAll();
      } else live.forEach(S.resumeClock);
    });
    window.addEventListener('pagehide', saveAll);

    boot();
  }

  GB.app = { state, runDemo, openSetup };
  document.addEventListener('DOMContentLoaded', init);
})((globalThis.GB = globalThis.GB || {}));

/* GlitchBox — session manager
 * Player records, puzzle timers and LocalStorage persistence.
 * Simulated players (the scripted demo) use a virtual clock and are never saved.
 */
(function (GB) {
  'use strict';

  const STORAGE_KEY = 'glitchbox:v1';

  function now(player) {
    return player && player.sim ? player.simNow : Date.now();
  }

  function caseId() {
    const n = Math.floor(Math.random() * 9000 + 1000);
    return `GB-26·${n}`;
  }

  function newPuzzleState(puzzleId, player) {
    return {
      puzzleId,
      wrong: 0,
      wrongAnswers: [],
      hintsRequested: 0,
      cluesOffered: 0,
      hintLog: [], // [{ key, source, reason }]
      solved: false,
      elapsedMs: 0,
      resumedAt: now(player),
    };
  }

  function createPlayer(opts) {
    const o = opts || {};
    const player = {
      id: Math.random().toString(36).slice(2, 10),
      name: (o.name || '').trim() || 'Player',
      slot: o.slot || 'solo', // 'solo' | 'A' | 'B'
      sim: !!o.sim,
      simNow: 0,
      caseId: caseId(),
      createdAt: Date.now(),
      status: 'playing', // 'playing' | 'complete'
      branch: null,
      roomIndex: 0,
      route: [{ room: 0, puzzleId: GB.puzzles.START_ID, branch: 'shared', variant: 'primary' }],
      history: [], // one record per solved room
      events: [], // adaptation events, newest last
      submissions: 0,
      correctSubmissions: 0,
      streak: 0,
      bestStreak: 0,
      pending: null, // decision waiting for "next room"
      current: null,
    };
    player.current = newPuzzleState(GB.puzzles.START_ID, player);
    return player;
  }

  // Elapsed time on the current puzzle, including the running segment.
  function elapsed(player) {
    const st = player.current;
    if (!st) return 0;
    if (st.solved || st.paused) return st.elapsedMs;
    return st.elapsedMs + Math.max(0, now(player) - st.resumedAt);
  }

  // Folds the running segment into elapsedMs without stopping the clock.
  function foldClock(player) {
    const st = player.current;
    if (!st || st.solved) return;
    st.elapsedMs = elapsed(player);
    st.resumedAt = now(player);
  }

  // Stops the clock while the player is away (tab hidden, left the screen).
  function pauseClock(player) {
    if (!player || !player.current) return;
    foldClock(player);
    player.current.paused = true;
  }

  function resumeClock(player) {
    if (!player || !player.current || player.current.solved) return;
    player.current.resumedAt = now(player);
    player.current.paused = false;
  }

  // ---------- persistence ----------
  function readStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : null;
      return data && typeof data === 'object' ? data : {};
    } catch (e) {
      return {};
    }
  }

  function writeStore(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;
    }
  }

  function snapshot(player) {
    if (!player) return null;
    const copy = JSON.parse(JSON.stringify(player));
    foldClock(copy);
    return copy;
  }

  function isValidPlayer(p) {
    return p && typeof p === 'object' && p.current && GB.puzzles.get(p.current.puzzleId) && Array.isArray(p.history);
  }

  function hydrate(p) {
    if (!isValidPlayer(p)) return null;
    resumeClock(p);
    return p;
  }

  const store = {
    saveSolo(player) {
      if (!player || player.sim) return;
      const d = readStore();
      d.solo = snapshot(player);
      writeStore(d);
    },
    saveCompare(a, b) {
      if (!a || !b || a.sim || b.sim) return;
      const d = readStore();
      d.compare = { A: snapshot(a), B: snapshot(b) };
      writeStore(d);
    },
    loadSolo() {
      return hydrate(readStore().solo);
    },
    loadCompare() {
      const c = readStore().compare;
      if (!c) return null;
      const A = hydrate(c.A);
      const B = hydrate(c.B);
      return A && B ? { A, B } : null;
    },
    clearSolo() {
      const d = readStore();
      delete d.solo;
      writeStore(d);
    },
    clearCompare() {
      const d = readStore();
      delete d.compare;
      writeStore(d);
    },
    getSetting(key, fallback) {
      const s = readStore().settings || {};
      return key in s ? s[key] : fallback;
    },
    setSetting(key, value) {
      const d = readStore();
      d.settings = Object.assign({}, d.settings, { [key]: value });
      writeStore(d);
    },
    // Peek without starting clocks (for the "resume" card on setup).
    peek() {
      const d = readStore();
      return { solo: isValidPlayer(d.solo) ? d.solo : null, compare: d.compare && isValidPlayer(d.compare.A) && isValidPlayer(d.compare.B) ? d.compare : null };
    },
  };

  GB.session = { createPlayer, newPuzzleState, now, elapsed, pauseClock, resumeClock, store, STORAGE_KEY };
})((globalThis.GB = globalThis.GB || {}));

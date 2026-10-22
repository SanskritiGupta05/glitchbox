/* GlitchBox logic tests — run with: node tests/run-tests.js
 * Exercises puzzles, the adaptive engine, and the game controller without a browser.
 */
'use strict';
const path = require('path');
['puzzles', 'adaptiveEngine', 'sessionManager', 'game'].forEach((f) => require(path.join(__dirname, '..', 'js', f + '.js')));
const GB = globalThis.GB;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    console.log('  ✗ ' + name + '\n      ' + e.message);
  }
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || 'expected equal'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}
function ok(v, msg) {
  if (!v) throw new Error(msg || 'expected truthy');
}

// Simulated player with a virtual clock (seconds advance explicitly).
function simPlayer(name) {
  return GB.session.createPlayer({ name, sim: true });
}
function wait(p, s) {
  p.simNow += s * 1000;
}
function wrongFor(puzzle) {
  if (puzzle.interaction === 'number') return '1';
  if (puzzle.interaction === 'choice') return puzzle.options.find((o) => o.id !== puzzle.solution).id;
  if (puzzle.interaction === 'order') return puzzle.tokens.slice();
  if (puzzle.id === 'cipher-shift') return 'HUD';
  return '9'.repeat(String(puzzle.solution).length);
}

console.log('\nPuzzle library');
test('has at least 8 puzzles across all 8 required categories', () => {
  ok(GB.puzzles.list.length >= 8);
  const cats = new Set(GB.puzzles.list.map((p) => p.category));
  ['Number Sequence', 'Visual Pattern', 'Logical Deduction', 'Odd One Out', 'Code Decoding', 'Ordering & Sequencing', 'Rule-Based Pattern', 'Multi-Step Reasoning'].forEach((c) =>
    ok(cats.has(c), 'missing category ' + c)
  );
});
GB.puzzles.list.forEach((p) => {
  test(`${p.id}: solution validates, wrong + empty answers rejected`, () => {
    const good = p.parse(p.solution);
    ok(good.ok, 'solution failed to parse');
    ok(p.check(good.value), 'solution failed check');
    const bad = p.parse(wrongFor(p));
    ok(bad.ok && !p.check(bad.value), 'wrong answer accepted');
    ok(!p.parse(p.interaction === 'order' ? [] : '').ok, 'empty input accepted');
    eq(p.hints.length, 3, 'needs 3 hint levels');
    ok(p.alt && p.alt.label && typeof p.alt.html() === 'string', 'needs alternate format');
    ok(p.explanation && p.category && p.difficulty && p.id, 'missing metadata');
    ok(typeof p.render() === 'string');
  });
  test(`${p.id}: no hint text reveals the final answer`, () => {
    if (Array.isArray(p.solution)) return;
    const re = new RegExp(`\\b${p.solution}\\b`, 'i');
    const texts = p.hints.map((h) => h.text).concat(p.alt.html());
    // choice ids like "beta" are matched against the option label instead
    const label = p.options ? p.options.find((o) => o.id === p.solution).label : null;
    texts.forEach((t) => {
      ok(!(p.interaction !== 'choice' && re.test(t.replace(/<[^>]+>/g, ''))), `hint reveals ${p.solution}: ${t}`);
      if (label) ok(!t.includes(label), `hint reveals ${label}`);
    });
  });
});
test('number parser rejects non-numeric text without counting an attempt', () => {
  const p = simPlayer('X');
  const r = GB.game.submit(p, 'thirty two');
  eq(r.status, 'invalid');
  eq(p.submissions, 0);
  eq(p.current.wrong, 0);
});
test('ordering puzzle reports which clue is violated', () => {
  const p = GB.puzzles.get('order-agents');
  ok(/C1/.test(p.diagnose(['Ash', 'Rook', 'Mira', 'Vex', 'Juno'])));
  ok(/C2/.test(p.diagnose(['Ash', 'Mira', 'Juno', 'Rook', 'Vex'])));
  ok(/C3/.test(p.diagnose(['Vex', 'Ash', 'Rook', 'Mira', 'Juno'])));
  ok(/C4/.test(p.diagnose(['Rook', 'Ash', 'Mira', 'Juno', 'Vex'])));
});

console.log('\nAdaptive hints');
test('hint button reveals L1 → L2 → L3 → ALT, then reports exhausted', () => {
  const p = simPlayer('H');
  GB.game.submit(p, '24'); // one attempt so the structured rule doesn't trigger
  const keys = [1, 2, 3, 4].map(() => GB.game.requestHint(p).hint.key);
  eq(keys, ['L1', 'L2', 'L3', 'ALT']);
  eq(GB.game.requestHint(p).status, 'exhausted');
});
test('repeated hint requests before any attempt switch to a structured format', () => {
  const p = simPlayer('H2');
  eq(GB.game.requestHint(p).hint.key, 'L1');
  eq(GB.game.requestHint(p).hint.key, 'L2');
  const third = GB.game.requestHint(p).hint;
  eq(third.key, 'ALT');
  ok(/structured/.test(third.reason));
});
test('2 wrong → system offers Direction; 3 wrong → switches format', () => {
  const p = simPlayer('A');
  const r1 = GB.game.submit(p, '24');
  eq(r1.status, 'wrong');
  ok(r1.diagnosed && /gaps/.test(r1.message), 'diagnoses additive thinking');
  eq(r1.clue, null);
  const r2 = GB.game.submit(p, '20');
  eq(r2.clue.key, 'L2');
  eq(r2.clue.source, 'system');
  const r3 = GB.game.submit(p, '30');
  eq(r3.clue.key, 'ALT');
  ok(/visual breakdown/.test(r3.clue.reason));
});
test('after mistakes, the first requested hint skips the nudge', () => {
  const p = simPlayer('S');
  GB.game.submit(p, '24');
  GB.game.submit(p, '20'); // system already showed L2
  eq(GB.game.requestHint(p).hint.key, 'L1');
  const q = simPlayer('S2');
  q.current.wrong = 2; // simulate two misses with no system clue recorded
  eq(GB.game.requestHint(q).hint.key, 'L2');
});
test('the answer is never revealed automatically, even after many misses', () => {
  const p = simPlayer('M');
  ['24', '20', '30', '18', '64', '33', '31'].forEach((a) => GB.game.submit(p, a));
  eq(p.current.solved, false);
  eq(p.current.hintLog.map((h) => h.key).sort(), ['ALT', 'L2']);
});
test('resubmitting the same wrong answer does not cost an attempt', () => {
  const p = simPlayer('R');
  GB.game.submit(p, '24');
  eq(GB.game.submit(p, ' 24 ').status, 'repeat');
  eq(p.current.wrong, 1);
});

console.log('\nBranching');
function playerB() {
  const p = simPlayer('B');
  wait(p, 9);
  const r = GB.game.submit(p, '32');
  return { p, r };
}
function playerA() {
  const p = simPlayer('A');
  wait(p, 20);
  GB.game.submit(p, '24');
  wait(p, 15);
  GB.game.requestHint(p);
  wait(p, 20);
  GB.game.submit(p, '20');
  wait(p, 25);
  GB.game.submit(p, '30');
  wait(p, 20);
  const r = GB.game.submit(p, '32');
  return { p, r };
}
test('fast, hint-free first solve → Challenge Mode, harder sequence next', () => {
  const { p, r } = playerB();
  eq(r.status, 'correct');
  eq(r.record.outcome, 'strong');
  eq(r.decision.branch, 'challenge');
  eq(r.decision.puzzleId, 'seq-pronic');
});
test('struggling first solve → Guided path with a visual version of the same skill', () => {
  const { p, r } = playerA();
  eq(r.record.outcome, 'struggled');
  eq(r.decision.branch, 'guided');
  eq(r.decision.puzzleId, 'vis-growth');
  ok(r.decision.events.some((e) => e.type === 'format'));
});
test('accurate but slow first solve → Guided path, primary puzzle', () => {
  const p = simPlayer('Slow');
  wait(p, 90);
  const r = GB.game.submit(p, '32');
  eq(r.record.outcome, 'steady');
  eq(r.decision.branch, 'guided');
  eq(r.decision.puzzleId, 'seq-steps');
});
test('same start, different minds → different branches and next puzzles', () => {
  const a = playerA().r.decision;
  const b = playerB().r.decision;
  ok(a.branch !== b.branch && a.puzzleId !== b.puzzleId);
});
test('two strong Guided solves in a row unlock Challenge Mode', () => {
  const p = simPlayer('P');
  wait(p, 90);
  GB.game.submit(p, '32');
  GB.game.advance(p); // seq-steps
  wait(p, 10);
  GB.game.submit(p, '17');
  GB.game.advance(p); // odd-squares
  wait(p, 10);
  const r = GB.game.submit(p, '42');
  eq(r.decision.branch, 'challenge');
  eq(r.decision.puzzleId, 'logic-servers');
  ok(r.decision.events.some((e) => e.type === 'promote'));
});
test('struggling on Challenge Mode eases back to Guided', () => {
  const { p } = playerB();
  GB.game.advance(p); // seq-pronic
  GB.game.submit(p, '40');
  GB.game.submit(p, '60');
  const r = GB.game.submit(p, '42');
  eq(r.record.outcome, 'struggled');
  eq(r.decision.branch, 'guided');
  ok(r.decision.events.some((e) => e.type === 'ease'));
});
test('Challenge Mode holds system clues back one extra attempt', () => {
  const { p } = playerB();
  GB.game.advance(p);
  eq(GB.game.submit(p, '40').clue, null);
  eq(GB.game.submit(p, '60').clue, null);
  eq(GB.game.submit(p, '50').clue.key, 'L2');
});

console.log('\nSkipping');
test('skipping Room 01 records it as skipped, not solved, and eases the path', () => {
  const p = simPlayer('Sk');
  wait(p, 5);
  GB.game.submit(p, '24');
  const r = GB.game.skip(p);
  eq(r.status, 'skipped');
  eq(r.record.outcome, 'skipped');
  eq(p.correctSubmissions, 0);
  eq(r.decision.branch, 'guided');
  eq(r.decision.puzzleId, 'vis-growth');
  ok(p.events.some((e) => e.type === 'skip'));
  const s = GB.game.stats(p);
  eq([s.solved, s.skipped, s.roomsCleared], [0, 1, 1]);
  eq(s.avgTimeMs, null);
  eq(p.streak, 0);
});
test('skip is ignored once a room is solved; submit is ignored once skipped', () => {
  const { p } = playerB();
  eq(GB.game.skip(p).status, 'ignored');
  const q = simPlayer('Sk2');
  GB.game.skip(q);
  eq(GB.game.submit(q, '32').status, 'ignored');
  eq(GB.game.requestHint(q).status, 'ignored');
  eq(q.history.length, 1);
});
test('skipping on Challenge Mode eases back to Guided', () => {
  const { p } = playerB();
  GB.game.advance(p);
  const r = GB.game.skip(p);
  eq(r.decision.branch, 'guided');
  ok(r.decision.events.some((e) => e.type === 'ease'));
});
test('skipping every room still ends the run as complete', () => {
  const p = simPlayer('All');
  for (let i = 0; i < 5; i++) {
    const r = GB.game.skip(p);
    if (!r.final) ok(GB.game.advance(p));
  }
  eq(p.status, 'complete');
  eq(GB.game.stats(p).solved, 0);
  ok(p.events.some((e) => e.title === 'Case closed'));
});

console.log('\nFull runs and state safety');
function playThrough(p, solveFast) {
  let guard = 0;
  while (p.status !== 'complete' && guard++ < 10) {
    const puzzle = GB.game.puzzleOf(p);
    wait(p, solveFast ? 5 : 80);
    if (!solveFast) GB.game.submit(p, wrongFor(puzzle));
    const r = GB.game.submit(p, puzzle.solution);
    eq(r.status, 'correct', puzzle.id);
    if (!r.final) ok(GB.game.advance(p));
  }
  return p;
}
test('fast player completes all 5 rooms on Challenge Mode', () => {
  const p = playThrough(simPlayer('F'), true);
  eq(p.status, 'complete');
  eq(p.history.length, 5);
  eq(p.route.map((r) => r.puzzleId), ['seq-doubling', 'seq-pronic', 'cipher-shift', 'logic-servers', 'final-challenge']);
});
test('steady player completes all 5 rooms on Guided Discovery', () => {
  const p = playThrough(simPlayer('G'), false);
  eq(p.status, 'complete');
  eq(p.route.map((r) => r.puzzleId), ['seq-doubling', 'seq-steps', 'odd-squares', 'order-agents', 'final-guided']);
});
test('every puzzle in the library is reachable by some route', () => {
  const seen = new Set();
  Object.values(GB.engine.PATHS).forEach((slots) => slots.forEach((s) => [s.primary, s.alt].filter(Boolean).forEach((id) => seen.add(id))));
  seen.add(GB.puzzles.START_ID);
  GB.puzzles.list.forEach((p) => ok(seen.has(p.id), p.id + ' unreachable'));
});
test('double submission after solving is ignored; advance only applies once', () => {
  const { p } = playerB();
  eq(GB.game.submit(p, '32').status, 'ignored');
  eq(p.history.length, 1);
  ok(GB.game.advance(p));
  ok(!GB.game.advance(p));
  eq(p.roomIndex, 1);
});
test('submitting on a completed run is ignored', () => {
  const p = playThrough(simPlayer('Done'), true);
  eq(GB.game.submit(p, '1').status, 'ignored');
  eq(GB.game.requestHint(p).status, 'ignored');
});
test('stats and insights reflect actual data', () => {
  const { p } = playerA();
  const s = GB.game.stats(p);
  eq(s.roomsCleared, 1);
  eq(s.wrong, 3);
  eq(s.hints, 1);
  eq(s.clues, 2);
  eq(Math.round(s.accuracy * 100), 25);
  eq(s.avgTimeMs, 100000);
  ok(GB.game.insights(p).some((t) => /extra support on: Number Sequence/.test(t)));
});
test('timer stops while paused and continues from the same value on resume', () => {
  const p = simPlayer('T');
  wait(p, 30);
  GB.session.pauseClock(p);
  eq(GB.session.elapsed(p), 30000);
  wait(p, 500); // time away is not counted
  eq(GB.session.elapsed(p), 30000);
  GB.session.resumeClock(p);
  wait(p, 10);
  eq(GB.session.elapsed(p), 40000);
});
test('save → load round-trip keeps progress and pending decisions', () => {
  const mem = {};
  globalThis.localStorage = { getItem: (k) => mem[k] || null, setItem: (k, v) => (mem[k] = String(v)) };
  const p = GB.session.createPlayer({ name: 'Saver' });
  GB.game.submit(p, '24');
  GB.game.requestHint(p);
  GB.session.store.saveSolo(p);
  const back = GB.session.store.loadSolo();
  eq(back.name, 'Saver');
  eq(back.current.wrong, 1);
  eq(back.current.hintLog.length, 1);
  eq(GB.game.submit(back, '32').status, 'correct');
  GB.session.store.saveSolo(back);
  const again = GB.session.store.loadSolo();
  ok(again.pending && GB.game.advance(again));
  eq(again.roomIndex, 1);
  GB.session.store.clearSolo();
  eq(GB.session.store.loadSolo(), null);
  delete globalThis.localStorage;
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

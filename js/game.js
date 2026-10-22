/* GlitchBox — game controller (no DOM)
 * Applies player actions to state: submitting answers, requesting hints and
 * moving between rooms. The UI calls these; the tests call them directly.
 */
(function (GB) {
  'use strict';

  const E = () => GB.engine;
  const S = () => GB.session;

  function puzzleOf(player) {
    return GB.puzzles.get(player.current.puzzleId);
  }

  function logEvent(player, ev, room) {
    player.events.push(Object.assign({ room: room == null ? player.roomIndex : room, at: S().now(player) }, ev));
  }

  function formatAnswer(v) {
    return Array.isArray(v) ? v.join(' → ') : String(v);
  }

  // Submit an answer. Returns { status: 'correct'|'wrong'|'invalid'|'repeat'|'ignored', ... }
  function submit(player, raw) {
    if (!player || player.status === 'complete' || !player.current || player.current.solved) return { status: 'ignored' };
    const st = player.current;
    const puzzle = puzzleOf(player);
    const parsed = puzzle.parse(raw);
    if (!parsed.ok) return { status: 'invalid', message: parsed.error };

    // Re-submitting the exact same wrong answer doesn't cost another attempt.
    const key = JSON.stringify(parsed.value);
    if (st.wrongAnswers.some((w) => JSON.stringify(w) === key)) {
      return { status: 'repeat', message: `You already tried ${formatAnswer(parsed.value)}. Try a different answer.` };
    }

    player.submissions++;
    if (!st.firstAction) st.firstAction = 'attempt';

    if (puzzle.check(parsed.value)) {
      player.correctSubmissions++;
      return Object.assign({ status: 'correct' }, finishRoom(player, false));
    }

    st.wrong++;
    st.wrongAnswers.push(parsed.value);
    const diagnosis = puzzle.diagnose ? puzzle.diagnose(parsed.value) : null;
    const clue = E().onWrong(player);
    if (clue) {
      st.hintLog.push(clue);
      st.cluesOffered++;
      logEvent(player, { type: clue.key === 'ALT' ? 'format-switch' : 'clue', title: clue.key === 'ALT' ? 'Clue format switched' : 'Explicit clue offered', reason: clue.reason });
    }
    return {
      status: 'wrong',
      message: diagnosis || 'Not quite — the lock rejected that answer.',
      diagnosed: !!diagnosis,
      clue,
    };
  }

  // Closes the current room (solved or skipped), records it, and picks the next room.
  function finishRoom(player, skipped) {
    const st = player.current;
    const puzzle = puzzleOf(player);
    st.elapsedMs = S().elapsed(player);
    st.solved = true;
    st.skipped = skipped;
    const rec = {
      room: player.roomIndex,
      puzzleId: puzzle.id,
      title: puzzle.title,
      category: puzzle.category,
      difficulty: puzzle.difficulty,
      branch: player.branch || 'shared',
      skipped,
      wrong: st.wrong,
      hintsRequested: st.hintsRequested,
      cluesOffered: st.cluesOffered,
      hintKeys: st.hintLog.map((h) => h.key),
      firstAction: st.firstAction,
      timeMs: st.elapsedMs,
    };
    const cls = E().classifyOutcome(rec);
    rec.outcome = cls.outcome;
    rec.outcomeLabel = cls.label;
    rec.outcomeReason = cls.reason;
    player.history.push(rec);
    player.streak = !skipped && st.wrong === 0 ? player.streak + 1 : 0;
    player.bestStreak = Math.max(player.bestStreak, player.streak);
    if (skipped) logEvent(player, { type: 'skip', title: 'Room skipped', reason: cls.reason });

    if (player.roomIndex >= E().TOTAL_ROOMS - 1) {
      player.status = 'complete';
      player.completedAt = Date.now();
      logEvent(player, { type: 'complete', title: skipped ? 'Case closed' : 'Core unlocked', reason: cls.reason });
      return { record: rec, final: true };
    }
    const decision = E().chooseNext(player);
    player.pending = decision;
    decision.events.forEach((ev) => logEvent(player, Object.assign({ decision: true }, ev), decision.room));
    return { record: rec, decision };
  }

  // Give up on the current room. It is recorded as skipped — never as solved —
  // and the engine treats it like a room that needed support.
  function skip(player) {
    if (!player || player.status === 'complete' || !player.current || player.current.solved) return { status: 'ignored' };
    if (!player.current.firstAction) player.current.firstAction = 'skip';
    return Object.assign({ status: 'skipped' }, finishRoom(player, true));
  }

  function requestHint(player) {
    if (!player || player.status === 'complete' || !player.current || player.current.solved) return { status: 'ignored' };
    const st = player.current;
    const hint = E().nextHint(player);
    if (!hint) return { status: 'exhausted', message: 'Every clue for this room is already showing. The final step is yours.' };
    st.hintsRequested++;
    if (!st.firstAction) st.firstAction = 'hint';
    st.hintLog.push(hint);
    if (hint.adaptive) logEvent(player, { type: hint.key === 'ALT' ? 'format-switch' : 'clue', title: hint.key === 'ALT' ? 'Structured clue' : 'Straight to Direction', reason: hint.reason });
    return { status: 'hint', hint };
  }

  // Move to the room chosen at solve time. Only works once per decision.
  function advance(player) {
    const d = player && player.pending;
    if (!d) return false;
    player.pending = null;
    player.roomIndex = d.room;
    player.branch = d.branch;
    player.route.push({ room: d.room, puzzleId: d.puzzleId, branch: d.branch, variant: d.variant });
    player.current = S().newPuzzleState(d.puzzleId, player);
    return true;
  }

  // ---------- derived numbers for panels and reports ----------
  function stats(player) {
    const h = player.history;
    const cur = player.current && !player.current.solved ? player.current : null;
    const sum = (f) => h.reduce((a, r) => a + f(r), 0);
    const solvedTime = sum((r) => r.timeMs);
    const solvedRooms = h.filter((r) => !r.skipped);
    return {
      roomsCleared: h.length,
      solved: h.filter((r) => !r.skipped).length,
      skipped: h.filter((r) => r.skipped).length,
      totalRooms: E().TOTAL_ROOMS,
      submissions: player.submissions,
      wrong: sum((r) => r.wrong) + (cur ? cur.wrong : 0),
      hints: sum((r) => r.hintsRequested) + (cur ? cur.hintsRequested : 0),
      clues: sum((r) => r.cluesOffered) + (cur ? cur.cluesOffered : 0),
      accuracy: player.submissions ? player.correctSubmissions / player.submissions : null,
      avgTimeMs: solvedRooms.length ? solvedRooms.reduce((a, r) => a + r.timeMs, 0) / solvedRooms.length : null,
      totalTimeMs: solvedTime + (cur ? S().elapsed(player) : 0),
      streak: player.streak,
      bestStreak: player.bestStreak,
    };
  }

  // Observations about this session only — never labels about the person.
  function insights(player) {
    const h = player.history;
    if (!h.length) return ['Clear a room to start building playstyle insights.'];
    const out = [];
    const firstTry = h.filter((r) => r.wrong === 0 && !r.skipped).length;
    if (h.length >= 2 && firstTry / h.length >= 0.6) out.push(`Locked in the first attempt on ${firstTry} of ${h.length} rooms.`);
    const hintFirst = h.filter((r) => r.firstAction === 'hint').length;
    const tryFirst = h.filter((r) => r.firstAction === 'attempt' && r.wrong > 0 && r.hintsRequested > 0).length;
    if (hintFirst) out.push(`Gathered a clue before answering in ${hintFirst} room${hintFirst > 1 ? 's' : ''} — an information-first approach.`);
    else if (tryFirst) out.push('Tested ideas before asking for help.');
    const solvedRooms = h.filter((r) => !r.skipped);
    const fastest = solvedRooms.reduce((a, r) => (!a || r.timeMs < a.timeMs ? r : a), null);
    if (fastest) out.push(`Quickest room so far: ${fastest.title} (${Math.max(1, Math.round(fastest.timeMs / 1000))}s).`);
    const supported = [...new Set(h.filter((r) => r.outcome === 'struggled').map((r) => r.category))];
    if (supported.length) out.push(`Took extra support on: ${supported.join(', ')}.`);
    const skipped = [...new Set(h.filter((r) => r.skipped).map((r) => r.category))];
    if (skipped.length) out.push(`Chose to skip: ${skipped.join(', ')} — the box eased the next room.`);
    const alt = [...new Set(h.filter((r) => r.hintKeys.includes('ALT')).map((r) => r.category))];
    if (alt.length) out.push(`Alternate clue formats were used on: ${alt.join(', ')}.`);
    if (player.route.some((r) => r.branch === 'challenge')) out.push('Reached Challenge Mode during this run.');
    return out.slice(0, 5);
  }

  GB.game = { submit, skip, requestHint, advance, stats, insights, puzzleOf, formatAnswer };
})((globalThis.GB = globalThis.GB || {}));

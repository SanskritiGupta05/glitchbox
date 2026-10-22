/* GlitchBox — adaptive engine
 * Transparent, rule-based adaptation. No trained model, no network calls.
 * Everything the engine decides comes back with a human-readable `reason`
 * so the UI can show the player exactly why something changed.
 *
 * Tweak RULES to change thresholds; tweak PATHS to change which puzzle
 * each branch serves in each room.
 */
(function (GB) {
  'use strict';

  const RULES = {
    fastSolveSeconds: 60, // a "fast" solve: at or under this many seconds
    explicitClueAfterWrong: 2, // N wrong answers -> system offers a more explicit clue
    formatSwitchAfterWrong: 3, // N wrong answers -> clue switches to a different format
    structuredAfterRequests: 2, // N hint requests with no attempts -> next hint is structured
    struggleWrong: 2, // solved, but after >= N wrong answers -> "needed support"
    struggleHints: 2, // solved, but after >= N requested hints -> "needed support"
    promoteAfterStrongStreak: 2, // N strong solves in a row on Guided -> unlock Challenge
    challengeClueDelay: 1, // Challenge branch holds system clues back by N extra attempts
  };

  const TOTAL_ROOMS = 5;

  // Room 01 is shared. Rooms 02–05 are served per branch. `alt` is used when the
  // previous room needed support: same goal, a more concrete/visual format.
  const PATHS = {
    guided: [
      { primary: 'seq-steps', alt: 'vis-growth' },
      { primary: 'odd-squares', alt: 'rule-sides' },
      { primary: 'order-agents' },
      { primary: 'final-guided' },
    ],
    challenge: [{ primary: 'seq-pronic' }, { primary: 'cipher-shift' }, { primary: 'logic-servers' }, { primary: 'final-challenge' }],
  };

  const BRANCH_NAMES = { guided: 'Guided Discovery', challenge: 'Challenge Mode' };

  const HINT_ORDER = ['L1', 'L2', 'L3', 'ALT'];
  const HINT_LABELS = { L1: 'Nudge', L2: 'Direction', L3: 'Guided reasoning', ALT: 'Alternate format' };

  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const secs = (ms) => Math.max(1, Math.round(ms / 1000));

  // ---------- outcome of a solved room ----------
  function classifyOutcome(rec) {
    if (rec.skipped) {
      return { outcome: 'skipped', label: 'Skipped', reason: `Skipped after ${plural(rec.wrong, 'incorrect attempt')} and ${plural(rec.hintsRequested, 'requested hint')}.` };
    }
    if (rec.wrong >= RULES.struggleWrong || rec.hintsRequested >= RULES.struggleHints) {
      return {
        outcome: 'struggled',
        label: 'Needed support',
        reason: `Solved after ${plural(rec.wrong, 'incorrect attempt')} and ${plural(rec.hintsRequested, 'requested hint')}.`,
      };
    }
    const fast = rec.timeMs <= RULES.fastSolveSeconds * 1000;
    if (rec.wrong === 0 && rec.hintsRequested === 0 && rec.cluesOffered === 0 && fast) {
      return { outcome: 'strong', label: 'Fast & accurate', reason: `Solved first try in ${secs(rec.timeMs)}s with no hints.` };
    }
    const bits = [];
    if (rec.wrong) bits.push(plural(rec.wrong, 'incorrect attempt'));
    if (rec.hintsRequested) bits.push(plural(rec.hintsRequested, 'hint'));
    if (!fast) bits.push(`${secs(rec.timeMs)}s (over the ${RULES.fastSolveSeconds}s fast-solve mark)`);
    return { outcome: 'steady', label: 'Steady', reason: `Solved with ${bits.join(', ') || 'a little support'}.` };
  }

  function trailingStrong(history) {
    let n = 0;
    for (let i = history.length - 1; i >= 0 && history[i].outcome === 'strong'; i--) n++;
    return n;
  }

  // ---------- what comes next after a room is solved ----------
  function chooseNext(player) {
    const last = player.history[player.history.length - 1];
    const nextRoom = player.roomIndex + 1; // 0-based
    if (nextRoom >= TOTAL_ROOMS) return null;

    const events = [];
    let branch = player.branch;
    // A skipped room is treated like one that needed support: keep the next one manageable.
    const needsSupport = last.outcome === 'struggled' || last.outcome === 'skipped';

    if (player.roomIndex === 0) {
      // Rule 4 / Path selection: the branch is chosen from Room 01 behaviour only.
      if (last.outcome === 'strong') {
        branch = 'challenge';
        events.push({ type: 'branch-challenge', title: 'Challenge Mode unlocked', reason: `${last.outcomeReason} Next room steps up in difficulty and clues are held back.` });
      } else {
        branch = 'guided';
        events.push({
          type: 'branch-guided',
          title: 'Guided Discovery path',
          reason:
            needsSupport
              ? `${last.outcomeReason} The next room keeps the same skill at a gentler level, building up gradually.`
              : `${last.outcomeReason} The path builds difficulty gradually from here.`,
        });
      }
    } else if (branch === 'guided' && trailingStrong(player.history) >= RULES.promoteAfterStrongStreak) {
      // Rule 7: consistent strong performance unlocks the harder branch.
      branch = 'challenge';
      events.push({ type: 'promote', title: 'Challenge Mode unlocked', reason: `${RULES.promoteAfterStrongStreak} fast, hint-free solves in a row. Switching to the harder branch.` });
    } else if (branch === 'challenge' && needsSupport) {
      // Rule 5: correct after heavy support -> keep the next room manageable.
      branch = 'guided';
      events.push({ type: 'ease', title: 'Difficulty eased', reason: `${last.outcomeReason} The next room moves to the Guided path to stay manageable.` });
    } else if (last.outcome === 'strong') {
      events.push({ type: 'hold-strong', title: 'Pace confirmed', reason: `${last.outcomeReason} Staying on ${BRANCH_NAMES[branch]}.` });
    } else {
      events.push({ type: 'hold', title: 'Level held', reason: `${last.outcomeReason} Staying on ${BRANCH_NAMES[branch]} at the planned pace.` });
    }

    const slot = PATHS[branch][nextRoom - 1];
    let puzzleId = slot.primary;
    let variant = 'primary';
    // Rule 6: difficulty in a room -> approach the next skill from a different angle.
    if (slot.alt && needsSupport) {
      puzzleId = slot.alt;
      variant = 'alt';
      const alt = GB.puzzles.get(puzzleId);
      events.push({
        type: 'format',
        title: 'Same skill, new angle',
        reason: `${last.category} ${last.outcome === 'skipped' ? 'was skipped' : 'took extra support'}, so Room ${pad(nextRoom + 1)} uses a ${alt.category.toLowerCase()} instead of repeating the same format.`,
      });
    }
    return { room: nextRoom, branch, puzzleId, variant, events };
  }

  // ---------- hints ----------
  function clueDelay(player) {
    return player.branch === 'challenge' ? RULES.challengeClueDelay : 0;
  }

  // Called when the player presses the hint button.
  function nextHint(player) {
    const st = player.current;
    const shown = new Set(st.hintLog.map((h) => h.key));
    const unshown = HINT_ORDER.filter((k) => !shown.has(k));
    if (!unshown.length) return null;

    // Repeated hint requests without trying an answer -> structured format.
    if (!shown.has('ALT') && st.wrong === 0 && st.hintsRequested >= RULES.structuredAfterRequests) {
      return { key: 'ALT', source: 'requested', adaptive: true, reason: `${plural(st.hintsRequested, 'hint')} requested before any attempt, so this clue switches to a structured, step-by-step format.` };
    }
    // After mistakes, skip the gentlest nudge and give direction.
    if (!shown.has('L1') && !shown.has('L2') && st.wrong >= RULES.explicitClueAfterWrong + clueDelay(player)) {
      return { key: 'L2', source: 'requested', adaptive: true, reason: `${plural(st.wrong, 'incorrect attempt')} already, so the first clue skips the nudge and gives direction.` };
    }
    const key = unshown[0];
    const reasons = {
      L1: 'First request: a light nudge that keeps the rule hidden.',
      L2: 'Second level: points at the relationship to look for.',
      L3: 'Third level: walks through part of the reasoning — the last step is yours.',
      ALT: 'All text levels used: the same idea, shown in a different format.',
    };
    return { key, source: 'requested', reason: reasons[key] };
  }

  // Called after each wrong answer. May return a clue the system offers on its own.
  function onWrong(player) {
    const st = player.current;
    const shown = new Set(st.hintLog.map((h) => h.key));
    const d = clueDelay(player);
    const delayNote = d ? ' (Challenge Mode holds clues back one attempt longer.)' : '';

    if (st.wrong === RULES.formatSwitchAfterWrong + d) {
      const puzzle = GB.puzzles.get(st.puzzleId);
      if (!shown.has('ALT')) return { key: 'ALT', source: 'system', reason: `${plural(st.wrong, 'incorrect attempt')} → switched to a ${puzzle.alt.label} so the same idea is shown a different way.${delayNote}` };
      const k = ['L2', 'L3'].find((x) => !shown.has(x));
      if (k) return { key: k, source: 'system', reason: `${plural(st.wrong, 'incorrect attempt')} → offered the next clue level.${delayNote}` };
    } else if (st.wrong === RULES.explicitClueAfterWrong + d) {
      const k = ['L2', 'L3'].find((x) => !shown.has(x));
      if (k) return { key: k, source: 'system', reason: `${plural(st.wrong, 'incorrect attempt')} → offered a more explicit ${HINT_LABELS[k]} clue.${delayNote}` };
    }
    return null;
  }

  // ---------- live state for the adaptive panel ----------
  function liveState(player, elapsedMs) {
    const st = player.current;
    if (!st) return { code: 'IDLE', text: 'Waiting for a puzzle.' };
    const shown = st.hintLog.map((h) => h.key);
    if (st.solved) return { code: 'DECIDING', text: 'Room cleared. The next room has been chosen from how this one went.' };
    if (shown.includes('ALT')) return { code: 'REFRAMING', text: 'Clues have switched to a different format to show the same idea another way.' };
    if (st.wrong >= RULES.explicitClueAfterWrong) return { code: 'SUPPORTING', text: 'Several attempts so far, so clues are more explicit.' };
    if (st.hintsRequested > 0) return { code: 'ASSISTING', text: 'Hints are revealed one level at a time. The answer is never shown automatically.' };
    if (player.branch === 'challenge') return { code: 'CHALLENGING', text: 'Challenge Mode: harder rooms, and clues are held back longer.' };
    const left = Math.max(0, RULES.fastSolveSeconds - Math.floor((elapsedMs || 0) / 1000));
    return {
      code: 'OBSERVING',
      text: left > 0 ? `Watching attempts, time and hints. A first-try solve in the next ${left}s with no hints counts as a fast solve.` : 'Watching attempts, time and hints. Take your time — speed is only one signal.',
    };
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  GB.engine = { RULES, PATHS, TOTAL_ROOMS, BRANCH_NAMES, HINT_ORDER, HINT_LABELS, classifyOutcome, chooseNext, nextHint, onWrong, liveState, pad };
})((globalThis.GB = globalThis.GB || {}));

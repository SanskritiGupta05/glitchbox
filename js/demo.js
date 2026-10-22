/* GlitchBox — scripted "RUN DEMO"
 * A SIMULATED demonstration: inputs and timings are scripted, but every step
 * goes through the real chamber UI, game controller and adaptive engine.
 * Simulated players use a virtual clock (`simNow`), so the timings shown are
 * the scripted ones, not how long the animation takes.
 */
(function (GB) {
  'use strict';

  // p: which player acts · clock: simulated seconds that pass before the action
  const SCRIPT = [
    { cap: 'Both players face the same first puzzle: 2, 4, 8, 16, ?', pause: 2200 },
    { p: 'B', clock: 9, type: '32', cap: 'Player B answers 32 after 9 seconds — first try, no hints.' },
    { p: 'A', clock: 20, type: '24', cap: 'Player A tries 24. The box recognises they repeated the last gap, and says so.' },
    { p: 'A', clock: 15, hint: true, cap: 'Player A asks for a hint → Level 1 nudge. The rule stays hidden.' },
    { p: 'A', clock: 20, type: '20', cap: 'Second miss → the system offers a more explicit Direction clue on its own.' },
    { p: 'A', clock: 25, type: '30', cap: 'Third miss → the clue switches format: a to-scale visual breakdown.' },
    { p: 'A', clock: 20, type: '32', cap: 'Player A cracks it: 32. Solved — with support.' },
    { p: 'B', next: true, cap: 'Player B → Challenge Mode: a harder, layered sequence. Clues are held back.' },
    { p: 'A', next: true, cap: 'Player A → Guided Discovery: the same pattern skill, shown visually instead.' },
    { p: 'B', clock: 18, type: '42', cap: 'Player B solves the harder sequence first try.' },
    { p: 'A', clock: 30, hint: true, cap: 'Player A takes a nudge: count the blocks in each frame…' },
    { p: 'A', clock: 25, pick: 'b', cap: '…and picks the 9-block frame. Correct.' },
    { p: 'B', next: true, cap: 'Player B moves on to a code-breaking cipher.' },
    { p: 'A', next: true, cap: 'Player A moves on to an odd-one-out room, still on the Guided path.' },
    { end: true, cap: 'Same starting point. Different minds. Different paths.', pause: 0 },
  ];

  /* api: { chamber(slot), player(slot), caption(text, i, n, slot), sleep(ms), cancelled(), step() } */
  async function run(api) {
    for (let i = 0; i < SCRIPT.length; i++) {
      if (api.cancelled()) return false;
      const s = SCRIPT[i];
      api.caption(s.cap, i + 1, SCRIPT.length, s.p || null, !!s.end);
      if (s.end) break;
      await api.sleep(s.pause || 1100);
      if (api.cancelled()) return false;
      const ch = s.p && api.chamber(s.p);
      if (s.clock) api.player(s.p).simNow += s.clock * 1000;
      if (s.type) await ch.typeAnswer(s.type);
      else if (s.pick) await ch.pickOption(s.pick);
      else if (s.hint) ch.handleHint();
      else if (s.next) ch.next();
      api.step();
      await api.sleep(s.next ? 1500 : 1700);
    }
    return true;
  }

  GB.demo = { run, SCRIPT };
})((globalThis.GB = globalThis.GB || {}));

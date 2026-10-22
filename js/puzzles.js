/* GlitchBox — puzzle library
 * Every puzzle is plain data plus a few small functions:
 *   parse(raw)    -> { ok, value } | { ok:false, error }   (format check; never counts as an attempt)
 *   check(value)  -> boolean                                (the actual answer validation)
 *   diagnose(v)   -> string | null                          (context-aware feedback for a wrong answer)
 * Hints are stored by level (L1 nudge, L2 direction, L3 guided) plus one alternate
 * format (ALT) that re-explains the same idea visually or step by step.
 */
(function (GB) {
  'use strict';

  // ---------- input parsers ----------
  const EMPTY = 'Enter an answer before submitting.';

  function parseNumber(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return { ok: false, error: EMPTY };
    if (!/^-?\d+(\.\d+)?$/.test(s)) return { ok: false, error: 'This lock only accepts numbers.' };
    return { ok: true, value: Number(s) };
  }

  function parseWord(raw) {
    const s = String(raw == null ? '' : raw).trim().toUpperCase().replace(/\s+/g, '');
    if (!s) return { ok: false, error: EMPTY };
    if (!/^[A-Z]+$/.test(s)) return { ok: false, error: 'Letters only — no numbers or symbols.' };
    return { ok: true, value: s };
  }

  function parseDigits(n) {
    return function (raw) {
      const s = String(raw == null ? '' : raw).replace(/\s+/g, '');
      if (!s) return { ok: false, error: EMPTY };
      if (!/^\d+$/.test(s)) return { ok: false, error: 'The core only accepts digits.' };
      if (s.length !== n) return { ok: false, error: `The core expects exactly ${n} digits.` };
      return { ok: true, value: s };
    };
  }

  function parseChoice(raw) {
    const s = String(raw == null ? '' : raw);
    if (!s) return { ok: false, error: 'Select an option before submitting.' };
    if (!this.options.some((o) => o.id === s)) return { ok: false, error: 'Unknown option.' };
    return { ok: true, value: s };
  }

  function parseOrder(raw) {
    const arr = Array.isArray(raw) ? raw.filter(Boolean) : [];
    if (!arr.length) return { ok: false, error: 'Place the items in order before submitting.' };
    if (arr.length !== this.tokens.length) return { ok: false, error: `Fill all ${this.tokens.length} slots before submitting.` };
    return { ok: true, value: arr };
  }

  // ---------- rendering helpers (HTML strings, no DOM access) ----------
  function seqHTML(items) {
    return `<div class="seq" role="list" aria-label="Sequence: ${items.join(', ')}">${items
      .map((v, i) => `<span class="seq-item${v === '?' ? ' seq-q' : ''}" role="listitem" data-hl="t${i}">${v}</span>`)
      .join('')}</div>`;
  }

  // Chain of values with the operation between each pair; the last op is left as "?"
  function ladderHTML(values, ops, caption) {
    let out = '<div class="ladder">';
    values.forEach((v, i) => {
      out += `<span class="ladder-val${v === '?' ? ' is-q' : ''}">${v}</span>`;
      if (i < ops.length) out += `<span class="ladder-op${ops[i].includes('?') ? ' is-q' : ''}">${ops[i]}</span>`;
    });
    return out + `</div>${caption ? `<p class="alt-caption">${caption}</p>` : ''}`;
  }

  function stepsHTML(steps, caption) {
    return `<ol class="alt-steps">${steps.map((s) => `<li>${s}</li>`).join('')}</ol>${caption ? `<p class="alt-caption">${caption}</p>` : ''}`;
  }

  // Regular polygon as inline SVG; `dots` marks the corners so they can be counted.
  function shapeSVG(sides, opts) {
    const o = opts || {};
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
      pts.push([50 + 38 * Math.cos(a), 52 + 38 * Math.sin(a)]);
    }
    const poly = pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');
    const dots = o.dots ? pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="5" class="shape-dot"/>`).join('') : '';
    return `<svg class="shape ${o.cls || ''}" viewBox="0 0 100 100" role="img" aria-label="${o.label || sides + '-sided shape'}"><polygon points="${poly}"/>${dots}</svg>`;
  }

  function blocksHTML(n, prev, hlKey) {
    let s = '<div class="blocks">';
    for (let i = 0; i < n; i++) s += `<span class="block"${i >= prev && hlKey ? ` data-hl="${hlKey}"` : ''}></span>`;
    return s + '</div>';
  }

  // ---------- the library ----------
  const list = [
    // ROOM 01 — shared starting puzzle for every player
    {
      id: 'seq-doubling',
      title: 'The Doubling Signal',
      category: 'Number Sequence',
      skill: 'numeric-pattern',
      difficulty: 2,
      brief: 'A corrupted transmission repeats one rule. Complete the pattern to open the first lock.',
      interaction: 'number',
      solution: '32',
      render: () => seqHTML([2, 4, 8, 16, '?']),
      parse: parseNumber,
      check: (v) => v === 32,
      diagnose(v) {
        if (v === 24) return '24 = 16 + 8: you repeated the last gap. But the gaps themselves are growing (+2, +4, +8).';
        if (v === 18 || v === 20 || v === 22) return 'Adding a fixed amount won’t work here — the jumps between numbers keep getting bigger.';
        if (v === 256) return '16 × 16 squares the last number. Does squaring explain 2 → 4 → 8?';
        if (v <= 16) return 'This signal only climbs. Your answer needs to be bigger than 16.';
        return null;
      },
      hints: [
        { text: 'Don’t just look at the numbers — look at what happens <em>between</em> them.' },
        { text: 'The gaps are +2, +4, +8, so adding won’t hold. Is there a single operation that turns every number into the next one?', highlight: ['t0', 't1', 't2', 't3'] },
        { text: 'Try dividing neighbours: 4 ÷ 2, 8 ÷ 4, 16 ÷ 8. They all give the same result. Apply that same step to 16.' },
      ],
      alt: {
        label: 'visual breakdown',
        html: () =>
          `<div class="bars">${[2, 4, 8, 16]
            .map((v) => `<div class="bar-row"><span class="bar-label">${v}</span><span class="bar" style="--w:${(v / 16) * 48}%"></span><span class="bar-x">${v < 16 ? '×2' : '×?'}</span></div>`)
            .join('')}<div class="bar-row"><span class="bar-label">?</span><span class="bar is-q" style="--w:96%"></span></div></div><p class="alt-caption">Bars are drawn to scale. Each one is a fixed multiple of the bar above it.</p>`,
      },
      explanation: 'Each term doubles: 2 × 2 = 4, 4 × 2 = 8, 8 × 2 = 16, so 16 × 2 = 32.',
    },

    // GUIDED — room 02 (primary)
    {
      id: 'seq-steps',
      title: 'Steady Pulse',
      category: 'Number Sequence',
      skill: 'numeric-pattern',
      difficulty: 1,
      brief: 'A cleaner signal this time. Find the steady rhythm and predict the next pulse.',
      interaction: 'number',
      solution: '17',
      render: () => seqHTML([5, 8, 11, 14, '?']),
      parse: parseNumber,
      check: (v) => v === 17,
      diagnose(v) {
        if (v === 28) return 'Doubling worked last room, but check it here: 5 × 2 isn’t 8.';
        if (v === 16 || v === 18) return 'Close. Count the step size again from 11 to 14.';
        if (v <= 14) return 'The pulse rises every time — your answer should be above 14.';
        return null;
      },
      hints: [
        { text: 'This signal moves at a perfectly steady rhythm.' },
        { text: 'Compare neighbours: 8 − 5, 11 − 8, 14 − 11. What do you notice?', highlight: ['t0', 't1', 't2', 't3'] },
        { text: 'Every step adds the same amount: 5 → 8, 8 → 11, 11 → 14 are identical jumps. Take one more jump from 14.' },
      ],
      alt: { label: 'step ladder', html: () => ladderHTML([5, 8, 11, 14, '?'], ['+3', '+3', '+3', '+?'], 'Each arrow is the same size. What goes on the last one?') },
      explanation: 'The sequence adds 3 each time: 14 + 3 = 17.',
    },

    // GUIDED — room 02 (alternate: same numeric skill, visual format)
    {
      id: 'vis-growth',
      title: 'Growing Signal',
      category: 'Visual Pattern',
      skill: 'numeric-pattern',
      difficulty: 1,
      brief: 'Same idea, new view. Each frame of the signal grows by a rule. Which frame comes next?',
      interaction: 'choice',
      solution: 'b',
      render: () =>
        `<div class="frames">${[1, 3, 5, 7]
          .map((n, i, a) => `<div class="frame"><span class="frame-label">F${i + 1}</span>${blocksHTML(n, i ? a[i - 1] : n, 'new')}</div>`)
          .join('')}<div class="frame is-q"><span class="frame-label">F5</span><span class="frame-q">?</span></div></div>`,
      options: [
        { id: 'a', label: '8 blocks', html: blocksHTML(8, 8) },
        { id: 'b', label: '9 blocks', html: blocksHTML(9, 9) },
        { id: 'c', label: '11 blocks', html: blocksHTML(11, 11) },
        { id: 'd', label: '14 blocks', html: blocksHTML(14, 14) },
      ],
      parse: parseChoice,
      check: (v) => v === 'b',
      diagnose(v) {
        if (v === 'a') return 'That adds only one block. Count how many new blocks appear between frames.';
        if (v === 'c') return 'That adds four blocks. Check the step size between F3 and F4 again.';
        if (v === 'd') return 'That doubles the last frame. This signal grows by adding, not multiplying.';
        return null;
      },
      hints: [
        { text: 'Count the blocks in each frame before comparing the options.' },
        { text: 'The newly added blocks in each frame are now highlighted. How many appear each time?', highlight: ['new'] },
        { text: 'F1 → F2 → F3 → F4 grows by the same number of highlighted blocks every step. Add that many to F4’s count.', highlight: ['new'] },
      ],
      alt: { label: 'counting table', html: () => stepsHTML(['F1: 1 block', 'F2: 3 blocks (+2)', 'F3: 5 blocks (+2)', 'F4: 7 blocks (+?)', 'F5: 7 + ? blocks'], 'Fill in the same step once more.') },
      explanation: 'Each frame adds 2 blocks: 1, 3, 5, 7 → 9.',
    },

    // GUIDED — room 03 (primary)
    {
      id: 'odd-squares',
      title: 'The Intruder Node',
      category: 'Odd One Out',
      skill: 'classification',
      difficulty: 2,
      brief: 'Four of these network nodes were built by the same rule. One was planted. Find the intruder.',
      interaction: 'choice',
      solution: '42',
      render: () => '<p class="prompt">Which node doesn’t belong?</p>',
      options: [16, 25, 36, 42, 49].map((n) => ({ id: String(n), label: String(n), html: `<span class="node" data-hl="n${n}">${n}</span>` })),
      parse: parseChoice,
      check: (v) => v === '42',
      diagnose(v) {
        if (v === '25' || v === '49') return `${v} is odd, but so is another node — "odd vs even" doesn’t isolate a single intruder.`;
        if (v === '16' || v === '36') return `${v} fits the hidden rule. Think about how ${v} can be built from a single number.`;
        return null;
      },
      hints: [
        { text: 'Four of these were built the same way. Odd/even won’t give you a single answer.' },
        { text: 'Think about multiplication tables — specifically, a number multiplied by <em>itself</em>.' },
        { text: '16 = 4 × 4 and 25 = 5 × 5. Check each remaining node: can it be written as some whole number times itself?' },
      ],
      alt: { label: 'checklist', html: () => stepsHTML(['Work out 4 × 4', 'Work out 5 × 5', 'Work out 6 × 6', 'Work out 7 × 7'], 'Which node is missing from your list of results?') },
      explanation: '16, 25, 36 and 49 are perfect squares (4², 5², 6², 7²). 42 is not.',
    },

    // GUIDED — room 03 (alternate: concrete, visual rule)
    {
      id: 'rule-sides',
      title: 'Shape Cipher',
      category: 'Rule-Based Pattern',
      skill: 'rule-finding',
      difficulty: 1,
      brief: 'The box assigns each shape a value. Discover the rule, then use it.',
      interaction: 'number',
      solution: '9',
      render: () =>
        `<div class="shape-eqs">
          <div class="shape-eq">${shapeSVG(3, { label: 'triangle' })}<span>= 3</span></div>
          <div class="shape-eq">${shapeSVG(4, { label: 'square' })}<span>= 4</span></div>
          <div class="shape-eq">${shapeSVG(5, { label: 'pentagon' })}<span>= 5</span></div>
        </div>
        <div class="shape-q">${shapeSVG(3, { label: 'triangle' })}<span>+</span>${shapeSVG(6, { label: 'hexagon', cls: 'is-q' })}<span>= ?</span></div>`,
      parse: parseNumber,
      check: (v) => v === 9,
      diagnose(v) {
        if (v === 6) return '6 is the hexagon on its own — the lock asks for triangle + hexagon.';
        if (v === 8) return 'Close. Count the hexagon’s sides once more.';
        if (v === 18) return 'That multiplies. The question uses +.';
        return null;
      },
      hints: [
        { text: 'The numbers aren’t random — they describe the shapes themselves.' },
        { text: 'Count something you can see on each shape: its corners or its sides.' },
        { text: 'A triangle has 3 sides, a square 4, a pentagon 5. Count the hexagon’s sides, then add the triangle’s value.' },
      ],
      alt: {
        label: 'corner-marked shapes',
        html: () =>
          `<div class="shape-eqs">${[3, 4, 5, 6].map((n) => `<div class="shape-eq">${shapeSVG(n, { dots: true })}<span>${n < 6 ? '= ' + n : '= ?'}</span></div>`).join('')}</div><p class="alt-caption">Count the dots on the last shape, then add 3.</p>`,
      },
      explanation: 'Each shape is worth its number of sides. Triangle (3) + hexagon (6) = 9.',
    },

    // GUIDED — room 04
    {
      id: 'order-agents',
      title: 'Access Log',
      category: 'Ordering & Sequencing',
      skill: 'sequencing',
      difficulty: 3,
      brief: 'Five agents badged into the vault tonight. The log was scrambled. Restore the order using the clues.',
      interaction: 'order',
      solution: ['Ash', 'Rook', 'Mira', 'Juno', 'Vex'],
      tokens: ['Mira', 'Vex', 'Juno', 'Ash', 'Rook'],
      clues: ['Juno entered immediately after Mira.', 'Rook entered before Mira.', 'Vex entered last.', 'Ash entered before Rook.'],
      render() {
        return `<ol class="clues">${this.clues.map((c, i) => `<li data-hl="c${i}"><span class="clue-n">C${i + 1}</span>${c}</li>`).join('')}</ol>`;
      },
      parse: parseOrder,
      check: (v) => v.join() === 'Ash,Rook,Mira,Juno,Vex',
      diagnose(v) {
        const pos = (n) => v.indexOf(n);
        if (pos('Juno') !== pos('Mira') + 1) return 'Clue C1 isn’t satisfied: Juno must come directly after Mira.';
        if (!(pos('Rook') < pos('Mira'))) return 'Clue C2 isn’t satisfied: Rook has to come before Mira.';
        if (pos('Vex') !== 4) return 'Clue C3 isn’t satisfied: Vex belongs in the last slot.';
        if (!(pos('Ash') < pos('Rook'))) return 'Clue C4 isn’t satisfied: Ash has to come before Rook.';
        return null;
      },
      hints: [
        { text: 'Start with the clue that pins someone to an exact slot.', highlight: ['c2'] },
        { text: 'Vex is fixed last. Now chain the “before” clues together: who must come before whom?', highlight: ['c1', 'c3'] },
        { text: 'C4 and C2 form a chain: Ash → Rook → Mira. Juno must sit directly behind Mira. Place the chain, then fit Juno in.' },
      ],
      alt: {
        label: 'timeline frame',
        html: () =>
          `<div class="timeline">${['?', '?', '?', '?', 'Vex'].map((n, i) => `<span class="tl-slot${n === 'Vex' ? ' is-fixed' : ''}"><small>${i + 1}</small>${n}</span>`).join('')}</div>${stepsHTML(['Slot 5 is fixed: Vex.', 'Ash, Rook and Mira must appear in that order somewhere in slots 1–4.', 'Juno needs the slot right after Mira — so Mira can’t be in slot 4.'])}`,
      },
      explanation: 'Vex is last (C3). Ash → Rook → Mira (C4, C2), and Juno directly follows Mira (C1): Ash, Rook, Mira, Juno, Vex.',
    },

    // GUIDED — room 05 (final)
    {
      id: 'final-guided',
      title: 'The Core Lock',
      category: 'Multi-Step Reasoning',
      skill: 'multi-step',
      difficulty: 3,
      brief: 'The core of the box. Its code is three digits, A B C. Every clue leads back to A.',
      interaction: 'text',
      inputHint: '3 digits',
      solution: '246',
      render: () =>
        `<div class="lock-slots" aria-hidden="true"><span>A</span><span>B</span><span>C</span></div>
        <ol class="clues"><li data-hl="c0"><span class="clue-n">C1</span>A + B + C = 12</li><li data-hl="c1"><span class="clue-n">C2</span>B is double A</li><li data-hl="c2"><span class="clue-n">C3</span>C equals A + B</li></ol>`,
      parse: parseDigits(3),
      check: (v) => v === '246',
      diagnose(v) {
        const [a, b, c] = v.split('').map(Number);
        if (a + b + c !== 12) return `Your digits add up to ${a + b + c}. Clue C1 needs a total of 12.`;
        if (b !== 2 * a) return 'The total is right, but clue C2 fails: B must be exactly double A.';
        if (c !== a + b) return 'Clue C3 fails: C must equal A + B.';
        return null;
      },
      hints: [
        { text: 'Every clue links back to A. Find A and the rest follows.' },
        { text: 'Rewrite B and C using only A: B = 2A, and C = A + B. Now clue C1 has only one unknown.', highlight: ['c1', 'c2'] },
        { text: 'C = A + 2A = 3A, so A + 2A + 3A = 12, which means 6A = 12. Solve for A, then build B and C.' },
      ],
      alt: { label: 'substitution table', html: () => stepsHTML(['A = A', 'B = 2 × A', 'C = A + B = 3 × A', 'Total: A + 2A + 3A = 6A', '6A = 12 → A = ?'], 'Once A is known, B and C follow directly.') },
      explanation: 'B = 2A and C = 3A, so 6A = 12 and A = 2. Code: 2 4 6.',
    },

    // CHALLENGE — room 02
    {
      id: 'seq-pronic',
      title: 'Fractured Frequency',
      category: 'Number Sequence',
      skill: 'numeric-pattern',
      difficulty: 4,
      brief: 'The signal’s rule is layered now. Find what generates each term.',
      interaction: 'number',
      solution: '42',
      render: () => seqHTML([2, 6, 12, 20, 30, '?']),
      parse: parseNumber,
      check: (v) => v === 42,
      diagnose(v) {
        if (v === 40) return 'That repeats the last gap of +10, but the gaps themselves are growing.';
        if (v === 60) return 'Doubling fits 30 → 60 but not 2 → 6 or 6 → 12.';
        if (v <= 30) return 'The signal only climbs — your answer should exceed 30.';
        return null;
      },
      hints: [
        { text: 'The gaps tell a story of their own.' },
        { text: 'The differences are 4, 6, 8, 10… — or try reading each term as a product of two neighbouring numbers.' },
        { text: '2 = 1 × 2, 6 = 2 × 3, 12 = 3 × 4. Keep the pattern of products going.' },
      ],
      alt: { label: 'gap ladder', html: () => ladderHTML([2, 6, 12, 20, 30, '?'], ['+4', '+6', '+8', '+10', '+?'], 'The gap grows by the same amount each time.') },
      explanation: 'Each term is n × (n + 1): 1×2, 2×3, 3×4, 4×5, 5×6, so next is 6×7 = 42. Equivalently the gaps grow by 2: +12.',
    },

    // CHALLENGE — room 03
    {
      id: 'cipher-shift',
      title: 'Shifted Transmission',
      category: 'Code Decoding',
      skill: 'decoding',
      difficulty: 4,
      brief: 'You intercepted a known word and its encrypted form. Use it to break the cipher, then decrypt the message.',
      interaction: 'text',
      inputHint: 'decrypted word',
      solution: 'BOX',
      render: () =>
        `<div class="cipher"><div class="cipher-row"><span class="cipher-k">KNOWN</span><code data-hl="k0">GLITCH</code><span class="cipher-arrow">→</span><code data-hl="k1">JOLWFK</code></div>
        <div class="cipher-row is-target"><span class="cipher-k">DECRYPT</span><code class="cipher-msg">ERA</code><span class="cipher-arrow">→</span><code class="cipher-msg is-q">???</code></div></div>`,
      parse: parseWord,
      check: (v) => v === 'BOX',
      diagnose(v) {
        if (v === 'HUD') return 'You shifted forward. Decrypting runs the other way.';
        if (v.length !== 3) return 'The encrypted word has 3 letters, so the decrypted word does too.';
        return null;
      },
      hints: [
        { text: 'Line up each letter of GLITCH with its encrypted twin.', highlight: ['k0', 'k1'] },
        { text: 'Every letter moved the same distance along the alphabet.' },
        { text: 'G → J is three steps forward. To decrypt, step each letter of ERA three steps back (wrapping from A to Z).' },
      ],
      alt: {
        label: 'alphabet strip',
        html: () => {
          const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
          const row = (s, cls) => `<div class="strip-row ${cls}">${s.split('').map((c) => `<span>${c}</span>`).join('')}</div>`;
          return `<div class="strip">${row(A, 'plain')}${row(A.slice(3) + A.slice(0, 3), 'enc')}</div><p class="alt-caption">Top: real letter. Bottom: encrypted letter. Find E, R and A on the bottom row and read upwards.</p>`;
        },
      },
      explanation: 'It’s a shift cipher of +3 (G→J). Shifting E, R, A back by 3 gives B, O, X.',
    },

    // CHALLENGE — room 04
    {
      id: 'logic-servers',
      title: 'Three Servers',
      category: 'Logical Deduction',
      skill: 'deduction',
      difficulty: 5,
      brief: 'Clean servers always tell the truth. Corrupted servers always lie. Exactly one consistent answer exists.',
      interaction: 'choice',
      solution: 'beta',
      render: () =>
        `<div class="servers">
          <div class="server" data-hl="s0"><span class="server-id">ALPHA</span>“Beta is corrupted.”</div>
          <div class="server" data-hl="s1"><span class="server-id">BETA</span>“Gamma is corrupted.”</div>
          <div class="server" data-hl="s2"><span class="server-id">GAMMA</span>“Alpha and Beta are both corrupted.”</div>
        </div><p class="prompt">Which server(s) are clean?</p>`,
      options: [
        { id: 'alpha', label: 'Alpha only', html: 'Alpha only' },
        { id: 'beta', label: 'Beta only', html: 'Beta only' },
        { id: 'gamma', label: 'Gamma only', html: 'Gamma only' },
        { id: 'alpha-gamma', label: 'Alpha and Gamma', html: 'Alpha and Gamma' },
      ],
      parse: parseChoice,
      check: (v) => v === 'beta',
      diagnose(v) {
        if (v === 'alpha') return 'If Alpha is clean, Beta lies — which makes Gamma clean as well. Your answer leaves Gamma corrupted.';
        if (v === 'gamma') return 'If Gamma is clean, Alpha is corrupted — so Alpha’s claim is false and Beta is clean. That contradicts Gamma.';
        if (v === 'alpha-gamma') return 'Gamma says Alpha is corrupted. They can’t both be truthful.';
        return null;
      },
      hints: [
        { text: 'Assume one server is clean and follow the consequences.' },
        { text: 'Try assuming Alpha is clean. What does that force about Beta — and then about Gamma? Look for a contradiction.', highlight: ['s0'] },
        { text: 'If Alpha were clean: Beta is corrupted, so Beta lies, so Gamma is clean — but Gamma then calls Alpha corrupted. Contradiction. So Alpha lies. What does that make Beta?' },
      ],
      alt: {
        label: 'assumption tree',
        html: () =>
          stepsHTML(['Assume ALPHA clean → BETA corrupted → BETA’s claim false → GAMMA clean → GAMMA says Alpha corrupted ✗ contradiction', 'So ALPHA is corrupted → ALPHA’s claim is false → BETA is …?', 'Use BETA’s status to settle GAMMA, then check GAMMA’s statement is a lie.']),
      },
      explanation: 'Alpha can’t be clean (contradiction), so Alpha lies and Beta is clean. Beta’s claim makes Gamma corrupted, and Gamma’s claim is indeed false. Only Beta is clean.',
    },

    // CHALLENGE — room 05 (final)
    {
      id: 'final-challenge',
      title: 'The Core Lock — Deep Layer',
      category: 'Multi-Step Reasoning',
      skill: 'multi-step',
      difficulty: 5,
      brief: 'The core’s deepest layer. A four-digit code ABCD, all digits different.',
      interaction: 'text',
      inputHint: '4 digits',
      solution: '2365',
      render: () =>
        `<div class="lock-slots" aria-hidden="true"><span>A</span><span>B</span><span>C</span><span>D</span></div>
        <ol class="clues"><li data-hl="c0"><span class="clue-n">C1</span>A is smaller than B</li><li data-hl="c1"><span class="clue-n">C2</span>A × B = C</li><li data-hl="c2"><span class="clue-n">C3</span>D = A + B</li><li data-hl="c3"><span class="clue-n">C4</span>A + B + C + D = 16</li></ol>`,
      parse: parseDigits(4),
      check: (v) => v === '2365',
      diagnose(v) {
        const [a, b, c, d] = v.split('').map(Number);
        if (new Set(v).size !== 4) return 'All four digits must be different.';
        if (a + b + c + d !== 16) return `Your digits sum to ${a + b + c + d}. Clue C4 needs 16.`;
        if (a * b !== c) return 'Clue C2 fails: C must equal A × B.';
        if (d !== a + b) return 'Clue C3 fails: D must equal A + B.';
        if (!(a < b)) return 'Clue C1 fails: A must be smaller than B.';
        return null;
      },
      hints: [
        { text: 'Two digits control everything.' },
        { text: 'Express C and D using A and B, then substitute into the sum.', highlight: ['c1', 'c2', 'c3'] },
        { text: 'A + B + AB + (A + B) = 16. A can’t be 1 (C would equal B). Try A = 2 and see what B must be.' },
      ],
      alt: { label: 'substitution table', html: () => stepsHTML(['C = A × B', 'D = A + B', 'Sum: 2(A + B) + A × B = 16', 'A = 1 makes C = B (not allowed)', 'Test A = 2: 2(2 + B) + 2B = 16 → B = ?']) },
      explanation: 'With C = AB and D = A + B, the sum gives 2(A + B) + AB = 16. A = 2, B = 3 works: C = 6, D = 5 → 2365.',
    },
  ];

  const byId = {};
  list.forEach((p) => (byId[p.id] = p));

  // Each room clears one fragment of the hidden transmission (the final reveal).
  const FRAGMENTS = ['EVERY MIND', 'HAS A', 'PATTERN.', 'EVERY PUZZLE', 'HAS A WAY.'];

  GB.puzzles = {
    list,
    get: (id) => byId[id],
    FRAGMENTS,
    START_ID: 'seq-doubling',
    helpers: { shapeSVG },
  };
})((globalThis.GB = globalThis.GB || {}));

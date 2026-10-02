#!/usr/bin/env node
// Тест рушія: 25 еталонних шляхів із reference/golden_paths.json
// і повний перебір усіх шляхів зі звіркою з розділом 10 docs/spec.md.
'use strict';
const fs = require('fs');
const path = require('path');
const { createEngine } = require('../engine.js');

const root = path.join(__dirname, '..');
const scenario = JSON.parse(fs.readFileSync(path.join(root, 'data', 'scenario.json'), 'utf8'));
const golden = JSON.parse(fs.readFileSync(path.join(root, 'reference', 'golden_paths.json'), 'utf8'));
const E = createEngine(scenario);

let failures = 0;
function fail(msg) {
  failures++;
  console.log('  ПОМИЛКА: ' + msg);
}

// 1. Еталонні шляхи
console.log('1. Еталонні шляхи (reference/golden_paths.json)');
let passed = 0;
golden.forEach((g, i) => {
  let res;
  try {
    res = E.runPath(g.path);
  } catch (e) {
    fail('шлях ' + (i + 1) + ': ' + e.message);
    return;
  }
  const st = res.state;
  const ok = res.ending === g.ending && st.D === g.final.D && st.Z === g.final.Z && st.S === g.final.S &&
    (g.risk === undefined || res.risk === g.risk);
  if (ok) passed++;
  else fail('шлях ' + (i + 1) + ' ' + g.path.join(' ') + ': очікувалось ' + g.ending + ' ' + JSON.stringify(g.final) +
    ' R=' + g.risk + ', отримано ' + res.ending + ' ' + JSON.stringify({ D: st.D, Z: st.Z, S: st.S }) + ' R=' + res.risk);
});
console.log('  збіглося ' + passed + ' з ' + golden.length);

// 2. Повний перебір
console.log('\n2. Повний перебір усіх шляхів');
const OPT = { N1: 'В', N2: 'Б', N3: 'Б', FLASH: 'А', N4: 'В', N5: 'А', N6: 'А', N6B: 'В', N7: 'А', N8: 'В', N10: 'А', N11: 'Б' };
const ENDS = ['E1', 'E2', 'E3', 'E4', 'E5'];
let total = 0;
const count = {}, weighted = {};
ENDS.forEach(e => { count[e] = 0; weighted[e] = 0; });
let wFlash = 0, wN6B = 0;
const bySub = {};      // кількість неоптимальних -> {E1: кількість шляхів, ...}
const optionSeen = new Set();
const exprSeen = new Set();

function walk(st, cur, prob, sub, seen) {
  if (cur === null) {
    total++;
    const e = E.ending(st);
    count[e]++;
    weighted[e] += prob;
    if (seen.FLASH) wFlash += prob;
    if (seen.N6B) wN6B += prob;
    bySub[sub] = bySub[sub] || {};
    bySub[sub][e] = (bySub[sub][e] || 0) + 1;
    return;
  }
  if (cur === 'FLASH') exprSeen.add(E.NODE.FLASH.entry_expr);
  const node = E.NODE[cur];
  // У N9 оптимальні обидва варіанти А і В (у специфікації «А або В залежно від стану»).
  const isBest = letter => cur === 'N9' ? (letter === 'А' || letter === 'В') : letter === OPT[cur];
  for (let i = 0; i < node.options.length; i++) {
    const s2 = E.cloneState(st);
    const r = E.step(s2, cur, i);
    optionSeen.add(cur + node.options[i].letter);
    exprSeen.add(r.expr);
    if (r.walkout) exprSeen.add(scenario.walkout.expr);
    const seen2 = Object.assign({}, seen);
    seen2[cur] = true;
    walk(s2, r.next, prob / node.options.length, sub + (isBest(node.options[i].letter) ? 0 : 1), seen2);
  }
}
walk(E.newState(), 'N1', 1, 0, {});
ENDS.forEach(e => exprSeen.add(scenario.endings[e].expr));

const pct = x => Math.round(x * 100);
console.log('  шляхів: ' + total + ' (у специфікації 229203)');
if (total !== 229203) fail('кількість шляхів не 229203');

const allOptions = [];
scenario.nodes.forEach(n => n.options.forEach(o => allOptions.push(n.id + o.letter)));
const unreachable = allOptions.filter(o => !optionSeen.has(o));
console.log('  досяжних варіантів: ' + (allOptions.length - unreachable.length) + ' з ' + allOptions.length);
if (unreachable.length) fail('недосяжні варіанти ' + unreachable.join(' '));
const zeroEnds = ENDS.filter(e => !count[e]);
console.log('  досяжних фіналів: ' + (ENDS.length - zeroEnds.length) + ' з 5');
if (zeroEnds.length) fail('недосяжні фінали ' + zeroEnds.join(' '));
console.log('  виразів, що з\'являються: ' + exprSeen.size + ' з 10');
if (exprSeen.size !== 10) fail('з\'являються не всі вирази');

console.log('  кількість шляхів за фіналами: ' + ENDS.map(e => e + ' ' + count[e]).join(', '));

function compare(label, got, want) {
  const ok = got === want;
  if (!ok) fail(label + ': отримано ' + got + '%, у специфікації ' + want + '%');
  return label + ' ' + got + '%' + (ok ? '' : ' (у специфікації ' + want + '%)');
}

const specRandom = { E1: 7, E2: 22, E3: 9, E4: 16, E5: 46 };
console.log('  випадковий вибір: ' + ENDS.map(e => compare(e, pct(weighted[e]), specRandom[e])).join(', '));
console.log('  умовні вузли при випадковому виборі: ' + compare('FLASH', pct(wFlash), 24) + ', ' + compare('N6B', pct(wN6B), 8));

const specTable = {
  0: { E1: 100 },
  1: { E1: 87, E2: 13 },
  2: { E1: 74, E2: 26 },
  3: { E1: 60, E2: 36, E3: 2, E5: 2 },
  4: { E1: 46, E2: 41, E3: 6, E4: 1, E5: 7 }
};
console.log('  фінал за кількістю неоптимальних виборів (частка шляхів):');
for (let k = 0; k <= 4; k++) {
  const w = bySub[k] || {};
  const sum = ENDS.reduce((s, e) => s + (w[e] || 0), 0);
  const cells = ENDS.map(e => {
    const got = sum ? pct((w[e] || 0) / sum) : 0;
    const want = specTable[k][e] || 0;
    if (got !== want) fail('неоптимальних ' + k + ', ' + e + ': ' + got + '%, у специфікації ' + want + '%');
    return e + ' ' + got + '%' + (got !== want ? ' (спец. ' + want + '%)' : '');
  });
  console.log('    ' + k + ': ' + cells.join(', '));
}

console.log('\n' + (failures ? 'НЕ ПРОЙДЕНО: помилок ' + failures : 'УСЕ ПРОЙДЕНО'));
process.exit(failures ? 1 : 0);

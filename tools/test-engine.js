#!/usr/bin/env node
// Тест рушія:
// 1. 25 еталонних шляхів із reference/golden_paths.json (фінал, шкали, R, вирази, оцінка, гілка).
// 2. Повний перебір усіх шляхів: звірка з розділом 10 docs/spec.md, граф виразів на кожному екрані,
//    гнів лише після 5, сильні вирази не бувають проміжним кроком.
// 3. Звірка кожного шляху з reference/enumerate_paths.py (потрібен python3): файли мають збігтися.
// 4. Фрагменти: склеювання фрагментів кожного тексту дає вихідний текст.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createEngine, fragments } = require('../engine.js');
const { enumerate, line } = require('./enumerate.js');

const root = path.join(__dirname, '..');
const scenario = JSON.parse(fs.readFileSync(path.join(root, 'data', 'scenario.json'), 'utf8'));
const golden = JSON.parse(fs.readFileSync(path.join(root, 'reference', 'golden_paths.json'), 'utf8'));
const E = createEngine(scenario);

let failures = 0;
function fail(msg) {
  failures++;
  if (failures <= 40) console.log('  ПОМИЛКА: ' + msg);
}

// 1. Еталонні шляхи
console.log('1. Еталонні шляхи (reference/golden_paths.json)');
const KEYS = ['after_choice', 'entry_narr_face', 'entry_face', 'walkout_scene', 'next_node', 'grade', 'branch'];
let passed = 0, stepsChecked = 0;
golden.forEach((g, i) => {
  let res;
  try {
    res = E.runPath(g.path);
  } catch (e) {
    fail('шлях ' + (i + 1) + ': ' + e.message);
    return;
  }
  const st = res.state;
  let ok = res.ending === g.ending && st.D === g.final.D && st.Z === g.final.Z && st.S === g.final.S && res.risk === g.risk;
  if (!ok) fail('шлях ' + (i + 1) + ' ' + g.path.join(' ') + ': очікувалось ' + g.ending + ' ' + JSON.stringify(g.final) +
    ' R=' + g.risk + ', отримано ' + res.ending + ' ' + JSON.stringify({ D: st.D, Z: st.Z, S: st.S }) + ' R=' + res.risk);
  if (g.faces.length !== res.faces.length) { ok = false; fail('шлях ' + (i + 1) + ': інша кількість кроків'); }
  g.faces.forEach((want, k) => {
    const got = res.faces[k] || {};
    stepsChecked++;
    KEYS.forEach(key => {
      if (got[key] !== want[key]) {
        ok = false;
        fail('шлях ' + (i + 1) + ', крок ' + (k + 1) + ' (' + g.path[k] + '): ' + key + ' ' + got[key] + ', очікувалось ' + want[key]);
      }
    });
  });
  if (ok) passed++;
});
console.log('  збіглося ' + passed + ' з ' + golden.length + ' (кроків перевірено: ' + stepsChecked + ', на кожному ' + KEYS.join(', ') + ')');

// 2. Повний перебір
console.log('\n2. Повний перебір усіх шляхів');
const OPT = { N1: 'В', N2: 'Б', N3: 'Б', FLASH: 'А', N4: 'В', N5: 'А', N6: 'А', N6B: 'В', N7: 'А', N8: 'В', N10: 'А', N11: 'Б' };
const ENDS = ['E1', 'E2', 'E3', 'E4', 'E5'];
let total = 0;
const count = {}, weighted = {};
ENDS.forEach(e => { count[e] = 0; weighted[e] = 0; });
let wFlash = 0, wN6B = 0;
const bySub = {};
const optionSeen = new Set();
const exprSeen = new Set();
const jsLines = [];
let moves = 0, angerSeen = 0, exceptions = { FLASH: 0, session2: 0, epilogue: 0 };
const badMoves = new Map();

// Перехід виразу між двома сусідніми екранами
function move(a, b, where) {
  moves++;
  exprSeen.add(b);
  if (!E.isAllowed(a, b)) badMoves.set(a + '→' + b, where);
  if (b === 3 && a !== 3) {
    angerSeen++;
    if (a !== 5) fail('гнів не після 5 (' + a + ' → 3): ' + where);
  }
}
// Проміжний крок до цілі не може бути сильним виразом
function mild(face, target, where) {
  if (face !== target && E.STRONG[face]) fail('сильний вираз ' + face + ' як проміжний крок до ' + target + ': ' + where);
}

function walk(st, cur, prob, sub, seen, trail, last) {
  if (cur === null) {
    total++;
    const e = E.ending(st);
    count[e]++;
    weighted[e] += prob;
    if (seen.FLASH) wFlash += prob;
    if (seen.N6B) wN6B += prob;
    bySub[sub] = bySub[sub] || {};
    bySub[sub][e] = (bySub[sub][e] || 0) + 1;
    exceptions.epilogue++;
    exprSeen.add(scenario.endings[e].expr);
    return;
  }
  const node = E.NODE[cur];
  for (let i = 0; i < 3; i++) {
    const s2 = E.cloneState(st);
    const r = E.step(s2, cur, i);
    const label = cur + node.options[i].letter;
    const where = trail.concat(label).join(' ');
    optionSeen.add(label);
    move(last, r.expr, where + ', реакція');
    mild(r.expr, r.entry.target, where + ', реакція');
    let prev = r.expr;
    if (r.walkout) {
      move(prev, r.walkoutFace, where + ', сцена обриву');
      mild(r.walkoutFace, scenario.walkout.expr, where + ', сцена обриву');
      prev = r.walkoutFace;
    }
    if (r.session2) {
      // виняток: вхід у другу сесію, вираз зі стану через тиждень
      exceptions.session2++;
      exprSeen.add(r.session2Face);
      if (r.session2Face !== E.sessionEntryExpression(s2)) fail('вхід у другу сесію: ' + where);
      prev = r.session2Face;
    }
    if (r.next !== null) {
      if (r.next === 'FLASH') {
        // виняток: вхід у флешбек одразу entry_expr
        exceptions.FLASH++;
        exprSeen.add(r.entryNarrFace);
        if (r.entryNarrFace !== E.NODE.FLASH.entry_expr) fail('вхід у FLASH не ' + E.NODE.FLASH.entry_expr + ': ' + where);
      } else {
        move(prev, r.entryNarrFace, where + ', вхід у ' + r.next + ' (розповідь)');
      }
      move(r.entryNarrFace, r.entryFace, where + ', вхід у ' + r.next + ' (репліка)');
      const sit = E.NODE[r.next].sit_expr;
      if (sit !== undefined) {
        mild(r.entryNarrFace, sit, where + ', розповідь ' + r.next);
        mild(r.entryFace, sit, where + ', репліка ' + r.next);
      }
    }
    const seen2 = Object.assign({}, seen);
    seen2[cur] = true;
    const best = cur === 'N9' ? (i === 0 || i === 2) : node.options[i].letter === OPT[cur];
    walk(s2, r.next, prob / 3, sub + (best ? 0 : 1), seen2, trail.concat(label), r.next === null ? null : r.entryFace);
  }
}
const st0 = E.newState();
exprSeen.add(1);
move(1, st0.narr_face, 'вступ → N1 (розповідь)');
move(st0.narr_face, st0.face, 'N1 (репліка)');
walk(st0, 'N1', 1, 0, {}, [], st0.face);

const pct = x => Math.round(x * 100);
console.log('  шляхів: ' + total + ' (у специфікації 229203)');
if (total !== 229203) fail('кількість шляхів не 229203');
const allOptions = [];
scenario.nodes.forEach(n => n.options.forEach(o => allOptions.push(n.id + o.letter)));
const unreachable = allOptions.filter(o => !optionSeen.has(o));
console.log('  досяжних варіантів: ' + (allOptions.length - unreachable.length) + ' з ' + allOptions.length);
if (unreachable.length) fail('недосяжні варіанти ' + unreachable.join(' '));
const zeroEnds = ENDS.filter(e => !count[e]);
console.log('  досяжних фіналів: ' + (ENDS.length - zeroEnds.length) + ' з 5; шляхів за фіналами: ' + ENDS.map(e => e + ' ' + count[e]).join(', '));
if (zeroEnds.length) fail('недосяжні фінали ' + zeroEnds.join(' '));
const missing = [];
for (let k = 1; k <= 15; k++) if (!exprSeen.has(k)) missing.push(k);
console.log('  виразів, що з\'являються: ' + exprSeen.size + ' з 15' + (missing.length ? ', не з\'являються: ' + missing.join(', ') : ''));
if (missing.join() !== '7') fail('у специфікації не з\'являється лише 7, а тут: ' + missing.join(', '));

function compare(label, got, want) {
  const ok = got === want;
  if (!ok) fail(label + ': отримано ' + got + '%, у специфікації ' + want + '%');
  return label + ' ' + got + '%' + (ok ? '' : ' (у специфікації ' + want + '%)');
}
const specRandom = { E1: 7, E2: 22, E3: 9, E4: 16, E5: 46 };
console.log('  випадковий вибір: ' + ENDS.map(e => compare(e, pct(weighted[e]), specRandom[e])).join(', '));
console.log('  умовні вузли при випадковому виборі: ' + compare('FLASH', pct(wFlash), 24) + ', ' + compare('N6B', pct(wN6B), 8));
const specTable = {
  0: { E1: 100 }, 1: { E1: 87, E2: 13 }, 2: { E1: 74, E2: 26 },
  3: { E1: 60, E2: 36, E3: 2, E5: 2 }, 4: { E1: 46, E2: 41, E3: 6, E4: 1, E5: 7 }
};
console.log('  фінал за кількістю неоптимальних виборів:');
for (let k = 0; k <= 4; k++) {
  const w = bySub[k] || {};
  const sum = ENDS.reduce((s, e) => s + (w[e] || 0), 0);
  console.log('    ' + k + ': ' + ENDS.map(e => {
    const got = sum ? pct((w[e] || 0) / sum) : 0, want = specTable[k][e] || 0;
    if (got !== want) fail('неоптимальних ' + k + ', ' + e + ': ' + got + '%, у специфікації ' + want + '%');
    return e + ' ' + got + '%';
  }).join(', '));
}
console.log('  переходів між екранами перевірено на граф: ' + moves + ', поза графом: ' + badMoves.size);
badMoves.forEach((where, m) => fail('перехід ' + m + ' поза графом, напр. ' + where));
console.log('  винятки (поза графом за специфікацією): вхід у FLASH ' + exceptions.FLASH + ', вхід у другу сесію ' +
  exceptions.session2 + ', епілог ' + exceptions.epilogue);
console.log('  поява гніву (3): ' + angerSeen + ' разів, щоразу після 5');

// 3. Звірка з reference/enumerate_paths.py
console.log('\n3. Звірка з reference/enumerate_paths.py (повний перебір, один рядок на шлях)');
enumerate((s, p, fc) => { jsLines.push(line(s, p, fc)); });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-'));
const pyFile = path.join(tmp, 'py_paths.txt');
const jsFile = path.join(tmp, 'js_paths.txt');
fs.writeFileSync(jsFile, jsLines.join('\n') + '\n');
const py = spawnSync('python3', [path.join(root, 'reference', 'enumerate_paths.py')], { encoding: 'utf8', maxBuffer: 1 << 30 });
if (py.error || py.status !== 0) {
  fail('не вдалося запустити python3 reference/enumerate_paths.py: ' + (py.error ? py.error.message : py.stderr));
} else {
  fs.writeFileSync(pyFile, py.stdout);
  const pyLines = py.stdout.split('\n').filter(Boolean);
  console.log('  рядків у py_paths.txt: ' + pyLines.length + ', у js_paths.txt: ' + jsLines.length);
  let diff = 0;
  for (let k = 0; k < Math.max(pyLines.length, jsLines.length); k++) {
    if (pyLines[k] !== jsLines[k]) {
      if (diff < 5) fail('розбіжність у рядку ' + (k + 1) + ':\n    py ' + pyLines[k] + '\n    js ' + jsLines[k]);
      diff++;
    }
  }
  const same = fs.readFileSync(pyFile, 'utf8') === fs.readFileSync(jsFile, 'utf8');
  console.log('  розбіжних рядків (фінал, шкали, R, вирази після вибору, на розповіді, на репліці, сцена обриву): ' + diff +
    '; файли ' + (same ? 'ідентичні побайтово' : 'різні'));
  if (!same) fail('py_paths.txt і js_paths.txt різні');
}
fs.rmSync(tmp, { recursive: true, force: true });

// 4. Фрагменти
console.log('\n4. Фрагменти тексту');
const texts = [];
function add(where, t) { if (typeof t === 'string' && t) texts.push({ where: where, text: t }); }
scenario.intro.forEach((t, i) => add('вступ ' + (i + 1), t));
scenario.nodes.forEach(n => {
  add(n.id + ' narration', n.narration);
  add(n.id + ' situation', n.situation);
  (n.situation_by_Z || []).forEach(r => add(n.id + ' situation_by_Z ' + r[0] + '-' + r[1], r[2]));
  n.options.forEach(o => ['reply', 'reply_then', 'reply_else'].forEach(k => add(n.id + o.letter + ' ' + k, o[k])));
});
add('сцена обриву', scenario.walkout.text);
Object.keys(scenario.session2_entry).forEach(k => add('вхід у другу сесію (' + k + ')', scenario.session2_entry[k].text));
Object.keys(scenario.endings).forEach(k => add('епілог ' + k, scenario.endings[k].text));
const norm = s => s.replace(/\s+/g, ' ').trim();
let joinOk = 0, totalFrags = 0;
const cites = [];
texts.forEach(t => {
  const fr = fragments(t.text);
  t.n = fr.length;
  totalFrags += fr.length;
  if (norm(fr.map(f => f.text).join(' ')) === norm(t.text)) joinOk++;
  else fail('склеювання не дає вихідний текст: ' + t.where);
  fr.forEach(f => {
    if (!f.text.trim()) fail('порожній фрагмент: ' + t.where);
    if (f.kind === 'speech' && !/^«[^»]*»$/.test(f.text)) fail('репліка не в лапках: ' + t.where);
    if (f.kind === 'narr' && f.text.indexOf('«') >= 0) cites.push(t.where + ': ' + f.text.match(/«[^»]*»/g).join(', '));
  });
});
console.log('  текстів: ' + texts.length + ', фрагментів: ' + totalFrags + ', склеювання збіглося: ' + joinOk + ' з ' + texts.length);
console.log('  цитати всередині речення (лишились у розповіді): ' + cites.length);
cites.forEach(c => console.log('    ' + c));
if (cites.length !== 2) fail('очікувалось рівно 2 цитати (E4, E5)');
console.log('  п\'ять найдовших текстів:');
texts.slice().sort((a, b) => b.text.length - a.text.length).slice(0, 5).forEach(t => {
  console.log('    ' + t.where + ': ' + t.text.length + ' символів, фрагментів ' + t.n);
});
const sample = fragments('«Ви ж казали, що нікуди нічого не пишете.» Пауза. «Ну добре, хоч висплюся нарешті.» Він утомлено тре обличчя.');
const kinds = sample.map(f => f.kind).join(',');
console.log('  приклад із завдання: ' + sample.length + ' фрагменти (' + kinds + ')');
if (kinds !== 'speech,narr,speech,narr') fail('приклад із завдання поділено не так');

console.log('\n' + (failures ? 'НЕ ПРОЙДЕНО: помилок ' + failures : 'УСЕ ПРОЙДЕНО'));
process.exit(failures ? 1 : 0);

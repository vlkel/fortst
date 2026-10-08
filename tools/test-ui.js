#!/usr/bin/env node
// Перевірка index.html у headless Chromium (Playwright, не є залежністю проєкту).
// Запуск: NODE_PATH=$(npm root -g) node tools/test-ui.js [папка для скрінів]
//
// 1. Три контрольні шляхи в 1920x1080 і 1280x720: на кожному екрані вираз обличчя
//    (очікуваний рахує рушій, звірений з reference/engine.py), фінал, компонування, скріни.
// 2. Кожен варіант кожного вузла і обидві гілки кожної умови: компонування без прокручування.
// 3. Кнопка «Назад»: 30 випадкових шляхів з 1-2 поверненнями та іншим вибором, плюс повернення
//    через флешбек, N6B, сцену обриву, вхід у другу сесію і епілог. Кінцевий стан і екран розбору
//    мають збігтися з тим самим шляхом без повернень.
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { createEngine } = require('../engine.js');

const root = path.join(__dirname, '..');
const url = 'file://' + path.join(root, 'index.html');
const shotDir = process.argv[2] || path.join(root, 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });

const SC = JSON.parse(fs.readFileSync(path.join(root, 'data', 'scenario.json'), 'utf8'));
const ENG = createEngine(SC);
const LETTERS = ['А', 'Б', 'В'];
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const PHOTO_MIN = 110;

const PATHS = {
  optimal: { steps: 'N1В N2Б N3Б N4В N5А N6А N6BВ N7А N8В N9А N10А N11Б', ending: 'E1', input: 'click' },
  flash_walkout: { steps: 'N1А N2В N3В N4А N5Б FLASHА N6А N7А N8А N9А N10А N11А', ending: 'E5', input: 'keys' },
  e4: { steps: 'N1А N2А N3А N4А N5Б N6В N7Б N8Б N9А N10Б N11А', ending: 'E4', input: 'click' }
};

let failures = 0;
function fail(msg) { failures++; console.log('  ПОМИЛКА: ' + msg); }

// Мулберрі32: відтворюваний випадковий генератор
function rng(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Очікувана послідовність екранів для шляху (індекси варіантів), з виразом на кожному екрані
function expectScreens(idxs) {
  const st = ENG.newState();
  const out = [];
  for (let k = 0; k < SC.intro.length; k++) out.push({ screen: 'intro', expr: 1 });
  let cur = 'N1';
  const labels = [];
  for (const idx of idxs) {
    out.push({ screen: 'node', node: cur, expr: st.face });
    const r = ENG.step(st, cur, idx);
    labels.push(cur + LETTERS[idx]);
    out.push({ screen: 'reply', node: cur, expr: r.expr });
    if (r.walkout) out.push({ screen: 'walkout', expr: r.walkoutFace });
    if (r.session2) out.push({ screen: 'session2', expr: r.session2Face });
    cur = r.next;
    if (cur === null) break;
  }
  if (cur !== null) throw new Error('шлях не дійшов до епілогу');
  const end = ENG.ending(st);
  out.push({ screen: 'epilogue', expr: SC.endings[end].expr });
  out.push({ screen: 'debrief', expr: SC.endings[end].expr });
  return { screens: out, ending: end, labels: labels };
}

function parsePath(steps) {
  return steps.split(' ').map(p => LETTERS.indexOf(p.slice(-1)));
}

// Випадковий повний шлях (індекси варіантів)
function randomPath(rand) {
  const st = ENG.newState();
  let cur = 'N1';
  const idxs = [];
  while (cur !== null) {
    const i = Math.floor(rand() * 3);
    idxs.push(i);
    cur = ENG.step(st, cur, i).next;
  }
  return idxs;
}

async function info(page) {
  return page.evaluate(() => {
    const b = document.body;
    const face = document.querySelector('.stage .face');
    const photo = document.querySelector('.photo');
    const r = photo && photo.getBoundingClientRect();
    const de = document.documentElement;
    return {
      screen: b.dataset.screen, expr: Number(b.dataset.expr), node: b.dataset.node || null,
      faceExpr: face ? Number(face.dataset.expr) : null,
      photo: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) } : null,
      vh: window.innerHeight,
      vscroll: de.scrollHeight > window.innerHeight + 1,
      hscroll: de.scrollWidth > window.innerWidth,
      back: !!document.querySelector('[data-action="back"]'),
      hist: window.__novel.historyLength()
    };
  });
}

async function checkScreen(page, where, want, firstIntro) {
  const i = await info(page);
  if (want) {
    if (i.screen !== want.screen || (want.node && i.node !== want.node)) {
      fail(where + ': очікувався екран ' + want.screen + ' ' + (want.node || '') + ', а показано ' + i.screen + ' ' + (i.node || ''));
      return i;
    }
    if (i.expr !== want.expr) fail(where + ': вираз ' + i.expr + ', очікувався ' + want.expr);
  }
  if (i.hscroll) fail(where + ': горизонтальна прокрутка');
  if (i.back === !!firstIntro) fail(where + (firstIntro ? ': на першому екрані вступу є «Назад»' : ': немає кнопки «Назад»'));
  if (i.screen !== 'debrief') {
    if (i.vscroll) fail(where + ': не вміщається без прокручування (фото ' + (i.photo && i.photo.h) + ' px)');
    if (!i.photo || i.photo.top < 0 || i.photo.bottom > i.vh) fail(where + ': фото не повністю у вікні ' + JSON.stringify(i.photo));
    else if (i.photo.h < PHOTO_MIN) fail(where + ': фото менше за мінімум ' + i.photo.h);
    if (i.faceExpr !== i.expr) fail(where + ': клітинка обличчя ' + i.faceExpr + ' не дорівнює виразу ' + i.expr);
  }
  return i;
}

async function pressNext(page, how) {
  if (how === 'click') await page.click('[data-action="next"]');
  else await page.keyboard.press(how || 'Enter');
}

async function choose(page, idx, how) {
  if (how === 'click') await page.click('.option[data-letter="' + LETTERS[idx] + '"]');
  else await page.keyboard.press(String(idx + 1));
}

async function pressBack(page, k) {
  if (k % 2) await page.keyboard.press('Backspace');
  else await page.click('[data-action="back"]');
}

// Пройти шлях і звірити кожен екран. shots: функція (екран, номер) -> ім'я файла або null.
async function playChecked(page, idxs, where, opts) {
  opts = opts || {};
  const exp = expectScreens(idxs);
  await page.goto(url);
  let k = 0, step = 0;
  for (let s = 0; s < exp.screens.length; s++) {
    const want = exp.screens[s];
    const label = where + ' ' + (want.node ? want.node + ' ' : '') + want.screen;
    await checkScreen(page, label, want, s === 0);
    const shot = opts.shots && opts.shots(want, s, exp);
    if (shot) await page.screenshot({ path: path.join(shotDir, shot + '.png'), fullPage: shot.endsWith('-full') });
    if (want.screen === 'node') await choose(page, idxs[step++], opts.input);
    else if (want.screen !== 'debrief') await pressNext(page, opts.input === 'click' ? 'click' : ['Enter', ' '][k++ % 2]);
  }
  const code = (await page.textContent('.summary .ending-title')).slice(0, 2);
  if (code !== exp.ending) fail(where + ': фінал ' + code + ', очікувався ' + exp.ending);
  return exp;
}

// Кінцевий стан і екран розбору (для порівняння шляхів із поверненнями і без)
async function finalSnapshot(page) {
  return page.evaluate(() => ({
    state: JSON.stringify(window.__novel.state()),
    html: document.getElementById('app').innerHTML
  }));
}

// Пройти шлях idxs, але в кроках з events спершу обрати інший варіант, пройти вперед
// до умови until (або на depth екранів), повернутися «Назад» і обрати потрібний.
async function playWithBacks(page, idxs, events, where) {
  await page.goto(url);
  for (let k = 0; k < SC.intro.length; k++) await page.keyboard.press('Enter');
  let backs = 0;
  for (let step = 0; step < idxs.length; step++) {
    let i = await info(page);
    while (i.screen !== 'node') { await page.keyboard.press('Enter'); i = await info(page); }
    const ev = events.find(e => e.k === step);
    if (ev) {
      const mark = { hist: i.hist, node: i.node, expr: i.expr,
        state: await page.evaluate(() => JSON.stringify(window.__novel.state())) };
      await choose(page, ev.alt);
      let j = await info(page);
      let moved = 1;
      while (ev.until ? !ev.until(j) : moved < ev.depth) {
        if (j.screen === 'debrief') break;
        if (j.screen === 'node') await choose(page, 0); else await page.keyboard.press('Enter');
        moved++;
        j = await info(page);
        if (moved > 40) break;
      }
      if (ev.until && !ev.until(j)) fail(where + ': не дійшли до екрана ' + ev.name);
      if (ev.until) await checkScreen(page, where + ' перед поверненням (' + ev.name + ')', null);
      while (j.hist > mark.hist) {
        await pressBack(page, backs++);
        j = await info(page);
        await checkScreen(page, where + ' після «Назад» на ' + j.screen + ' ' + (j.node || ''), null, j.hist === 0);
      }
      const st = await page.evaluate(() => JSON.stringify(window.__novel.state()));
      if (j.screen !== 'node' || j.node !== mark.node) fail(where + ': «Назад» привів на ' + j.screen + ' ' + j.node + ' замість ' + mark.node);
      if (j.expr !== mark.expr) fail(where + ': після «Назад» вираз ' + j.expr + ' замість ' + mark.expr);
      if (st !== mark.state) fail(where + ': після «Назад» стан не той, що до вибору в ' + mark.node);
    }
    await choose(page, idxs[step]);
  }
  let i = await info(page);
  while (i.screen !== 'debrief') { await page.keyboard.press('Enter'); i = await info(page); }
  return backs;
}

// Набір шляхів, які разом проходять кожен варіант кожного вузла і обидві гілки кожної умови
function coverPaths() {
  const keys = new Set();
  const list = [];
  (function walk(st, cur, trail) {
    if (cur === null) return;
    for (let i = 0; i < 3; i++) {
      const s2 = ENG.cloneState(st);
      const r = ENG.step(s2, cur, i);
      const t = trail.concat(i);
      const key = cur + i + ':' + r.entry.cond;
      if (!keys.has(key)) {
        keys.add(key);
        const s3 = ENG.cloneState(s2);
        let c = r.next;
        const full = t.slice();
        while (c !== null) { full.push(0); c = ENG.step(s3, c, 0).next; }
        list.push(full);
      }
      walk(s2, r.next, t);
    }
  })(ENG.newState(), 'N1', []);
  return { list, keys: keys.size };
}

// Знайти шлях і крок, де інший варіант веде просто до події (флешбек, N6B, обрив, друга сесія, епілог)
function findEvent(rand, test) {
  for (let tries = 0; tries < 20000; tries++) {
    const idxs = randomPath(rand);
    const st = ENG.newState();
    let cur = 'N1';
    for (let k = 0; k < idxs.length; k++) {
      for (let alt = 0; alt < 3; alt++) {
        if (alt === idxs[k]) continue;
        const s2 = ENG.cloneState(st);
        if (test(ENG.step(s2, cur, alt), cur)) return { idxs, k, alt };
      }
      cur = ENG.step(st, cur, idxs[k]).next;
    }
  }
  throw new Error('подію не знайдено');
}

(async () => {
  const browser = await chromium.launch();
  const cover = coverPaths();
  for (const [w, hgt] of VIEWPORTS) {
    const size = w + 'x' + hgt;
    console.log('\n=== ' + size + ' ===');
    const page = await browser.newPage({ viewport: { width: w, height: hgt } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    // 1. Контрольні шляхи
    console.log('1. Контрольні шляхи');
    for (const [name, p] of Object.entries(PATHS)) {
      const idxs = parsePath(p.steps);
      const shots = (want, s) => {
        if (name === 'optimal') {
          if (want.screen === 'intro' && s === 1) return size + '-intro';
          if (want.screen === 'node' && want.node === 'N1') return size + '-node-N1';
          if (want.screen === 'node' && want.node === 'N5') return size + '-node-N5';
          if (want.screen === 'node' && want.node === 'N8') return size + '-node-N8';
          if (want.screen === 'reply' && want.node === 'N3') return size + '-reply';
          if (want.screen === 'session2') return size + '-session2-plan';
          if (want.screen === 'epilogue') return size + '-epilogue-E1';
          if (want.screen === 'debrief') return size + '-debrief-E1-full';
        }
        if (name === 'flash_walkout') {
          if (want.screen === 'node' && want.node === 'FLASH') return size + '-flash';
          if (want.screen === 'reply' && want.node === 'FLASH') return size + '-flash-reply';
          if (want.screen === 'walkout') return size + '-walkout';
          if (want.screen === 'session2') return size + '-session2';
          if (want.screen === 'epilogue') return size + '-epilogue-E5';
          if (want.screen === 'debrief') return size + '-debrief-E5';
        }
        if (name === 'e4' && (want.screen === 'epilogue' || want.screen === 'debrief')) return size + '-' + want.screen + '-E4';
        return null;
      };
      const exp = await playChecked(page, idxs, size + ' ' + name, { input: p.input, shots });
      if (exp.ending !== p.ending) fail(name + ': рушій дає ' + exp.ending + ', очікувався ' + p.ending);
      const faces = exp.screens.filter(s => s.screen !== 'intro' && s.screen !== 'debrief')
        .map(s => (s.screen === 'node' ? s.node + ' ' : s.screen === 'reply' ? '→' : s.screen + ' ') + s.expr);
      console.log('  ' + name + ' (' + exp.ending + '): ' + faces.join(', '));
      await page.click('[data-action="restart"]');
      const i = await info(page);
      if (i.screen !== 'intro' || i.expr !== 1 || i.back) fail('«Почати знову» не повертає на перший екран вступу');
    }

    // 2. Кожен варіант і гілка умови: компонування
    let checked = 0;
    for (const cp of cover.list) {
      await playChecked(page, cp, size + ' покриття');
      checked++;
    }
    console.log('2. Компонування: ' + checked + ' шляхів, покрито ' + cover.keys + ' варіантів і гілок умов');

    // Висота фото на кожному вузлі (найменша по всіх варіантах)
    const minPhoto = {};
    for (const cp of cover.list) {
      await page.goto(url);
      for (let k = 0; k < SC.intro.length; k++) await page.keyboard.press('Enter');
      for (const idx of cp) {
        let i = await info(page);
        while (i.screen !== 'node') { await page.keyboard.press('Enter'); i = await info(page); }
        minPhoto[i.node] = Math.min(minPhoto[i.node] || 1e9, i.photo.h);
        await choose(page, idx);
        i = await info(page);
        minPhoto.reply = Math.min(minPhoto.reply || 1e9, i.photo.h);
      }
    }
    console.log('   висота фото (найменша): ' + Object.entries(minPhoto).map(([k, v]) => k + ' ' + v).join(', '));

    // 3. «Назад»
    const rand = rng(w);
    let backTotal = 0, cases = 0;
    const straightCache = {};
    async function straight(idxs) {
      const key = idxs.join('');
      if (!straightCache[key]) {
        await page.goto(url);
        for (let k = 0; k < SC.intro.length; k++) await page.keyboard.press('Enter');
        for (const idx of idxs) {
          let i = await info(page);
          while (i.screen !== 'node') { await page.keyboard.press('Enter'); i = await info(page); }
          await choose(page, idx);
        }
        let i = await info(page);
        while (i.screen !== 'debrief') { await page.keyboard.press('Enter'); i = await info(page); }
        straightCache[key] = await finalSnapshot(page);
      }
      return straightCache[key];
    }
    async function compareRun(idxs, events, where) {
      backTotal += await playWithBacks(page, idxs, events, where);
      const got = await finalSnapshot(page);
      const want = await straight(idxs);
      if (got.state !== want.state) fail(where + ': кінцевий стан відрізняється від шляху без повернень');
      if (got.html !== want.html) fail(where + ': екран розбору відрізняється від шляху без повернень');
      cases++;
    }
    for (let n = 0; n < 30; n++) {
      const idxs = randomPath(rand);
      const count = 1 + Math.floor(rand() * 2);
      const ks = new Set();
      while (ks.size < count) ks.add(Math.floor(rand() * idxs.length));
      const events = [...ks].map(k => ({ k, alt: (idxs[k] + 1 + Math.floor(rand() * 2)) % 3, depth: 1 + Math.floor(rand() * 3) }));
      await compareRun(idxs, events, size + ' випадковий шлях ' + (n + 1));
    }
    const special = [
      ['флешбек', (r) => r.next === 'FLASH', j => j.screen === 'node' && j.node === 'FLASH'],
      ['N6B', (r) => r.next === 'N6B', j => j.screen === 'node' && j.node === 'N6B'],
      ['сцена обриву', (r) => r.walkout, j => j.screen === 'walkout'],
      ['вхід у другу сесію', (r) => !!r.session2, j => j.screen === 'session2'],
      ['епілог', (r) => r.next === null, j => j.screen === 'debrief']
    ];
    for (const [name, test, until] of special) {
      const f = findEvent(rand, test);
      await compareRun(f.idxs, [{ k: f.k, alt: f.alt, until, name }], size + ' повернення через ' + name);
      // подія на самому шляху: дійти до неї, повернутися назад крізь неї і обрати той самий варіант
      const f2 = findEvent(rand, test);
      const own = f2.idxs.slice(0, f2.k).concat(f2.alt);
      const s2 = ENG.newState();
      let cur = 'N1';
      own.forEach(i => { cur = ENG.step(s2, cur, i).next; });
      while (cur !== null) { own.push(0); cur = ENG.step(s2, cur, 0).next; }
      await compareRun(own, [{ k: f2.k, alt: f2.alt, until, name }], size + ' повернення через ' + name + ' і той самий вибір');
    }
    console.log('3. «Назад»: ' + cases + ' шляхів, натиснуто «Назад» ' + backTotal + ' разів');

    if (errors.length) fail('помилки JS: ' + errors.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + (failures ? 'НЕ ПРОЙДЕНО: помилок ' + failures : 'УСЕ ПРОЙДЕНО'));
  process.exit(failures ? 1 : 0);
})();

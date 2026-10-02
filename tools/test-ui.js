#!/usr/bin/env node
// Перевірка index.html у headless Chromium (Playwright, не є залежністю проєкту).
// Запуск: NODE_PATH=$(npm root -g) node tools/test-ui.js [папка для скрінів]
// Проходить три шляхи з docs/task.md у 1920x1080 і 1280x720, звіряє вираз обличчя
// після кожного вибору і фінал, шукає обрізаний текст і робить скріни.
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const url = 'file://' + path.join(root, 'index.html');
const shotDir = process.argv[2] || path.join(root, 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });

const PATHS = {
  optimal: {
    steps: 'N1 В 7, N2 Б 9, N3 Б 7, N4 В 7, N5 А 10, N6 А 10, N6B В 10, N7 А 10, N8 В 10, N9 А 10, N10 А 10, N11 Б 10',
    ending: 'E1', input: 'click'
  },
  flash_walkout: {
    steps: 'N1 А 1, N2 В 1, N3 В 2, N4 А 2, N5 Б 6, FLASH А 6, N6 А 6, N7 А 6, N8 А 3, N9 А 6, N10 А 6, N11 А 6',
    ending: 'E5', input: 'keys', walkoutAfter: 'N8'
  },
  e4: {
    steps: 'N1 А 1, N2 А 8, N3 А 3, N4 А 6, N5 Б 6, N6 В 6, N7 Б 6, N8 Б 6, N9 А 6, N10 Б 6, N11 А 6',
    ending: 'E4', input: 'click'
  }
};
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const LETTERS = ['А', 'Б', 'В'];

let failures = 0;
function fail(msg) { failures++; console.log('  ПОМИЛКА: ' + msg); }

async function info(page) {
  return page.evaluate(() => {
    const b = document.body;
    const panel = document.querySelector('.panel');
    const face = document.querySelector('.face');
    const r = face && face.getBoundingClientRect();
    return {
      screen: b.dataset.screen, expr: Number(b.dataset.expr), node: b.dataset.node,
      faceExpr: face ? Number(face.dataset.expr) : null,
      overflow: panel ? panel.scrollHeight > panel.clientHeight + 1 : false,
      faceBox: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), h: Math.round(r.height) } : null,
      vh: window.innerHeight,
      hscroll: document.documentElement.scrollWidth > window.innerWidth
    };
  });
}

async function checkLayout(page, where) {
  const i = await info(page);
  if (i.overflow) fail(where + ': текст не вміщається в панель');
  if (i.hscroll) fail(where + ': горизонтальна прокрутка');
  if (i.faceBox && (i.faceBox.bottom !== i.vh || i.faceBox.top !== 0)) fail(where + ': обличчя не на всю висоту ' + JSON.stringify(i.faceBox));
  if (i.faceBox && i.faceExpr !== i.expr) fail(where + ': клітинка обличчя ' + i.faceExpr + ' не дорівнює виразу ' + i.expr);
  return i;
}

async function next(page, how) {
  if (how === 'click') await page.click('[data-action="next"]');
  else await page.keyboard.press(how);
}

// Набір шляхів, які разом проходять кожен варіант кожного вузла і обидві гілки кожної умови
const { createEngine } = require('../engine.js');
const ENG = createEngine(JSON.parse(fs.readFileSync(path.join(root, 'data', 'scenario.json'), 'utf8')));
const coverKeys = new Set();
const coverPaths = [];
(function walk(st, cur, trail) {
  if (cur === null) return;
  for (let i = 0; i < 3; i++) {
    const s2 = ENG.cloneState(st);
    const r = ENG.step(s2, cur, i);
    const t = trail.concat({ node: cur, idx: i });
    const key = cur + i + ':' + r.entry.cond;
    if (!coverKeys.has(key)) {
      coverKeys.add(key);
      // дограти до кінця першими варіантами
      const s3 = ENG.cloneState(s2);
      let c = r.next;
      const full = t.slice();
      while (c !== null) { full.push({ node: c, idx: 0 }); c = ENG.step(s3, c, 0).next; }
      coverPaths.push(full);
    }
    walk(s2, r.next, t);
  }
})(ENG.newState(), 'N1', []);

(async () => {
  const browser = await chromium.launch();
  for (const [w, hgt] of VIEWPORTS) {
    const size = w + 'x' + hgt;
    console.log('\n=== ' + size + ' ===');
    const page = await browser.newPage({ viewport: { width: w, height: hgt } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    for (const [name, p] of Object.entries(PATHS)) {
      await page.goto(url);
      const shots = name === 'flash_walkout' || (name === 'optimal');
      // Вступ: 4 екрани, вираз 1
      for (let k = 0; k < 4; k++) {
        const i = await checkLayout(page, size + ' ' + name + ' вступ ' + (k + 1));
        if (i.screen !== 'intro' || i.expr !== 1) fail('вступ ' + (k + 1) + ': ' + JSON.stringify(i));
        if (name === 'optimal' && k === 1) await page.screenshot({ path: path.join(shotDir, size + '-intro.png') });
        await next(page, ['Enter', ' ', 'click', 'Enter'][k]);
      }
      const got = [];
      const steps = p.steps.split(', ').map(s => s.split(' '));
      for (let k = 0; k < steps.length; k++) {
        const [node, letter, want] = steps[k];
        let i = await checkLayout(page, size + ' ' + name + ' ' + node);
        if (i.screen !== 'node' || i.node !== node) { fail(name + ': очікувався вузол ' + node + ', а екран ' + i.screen + ' ' + i.node); break; }
        if (node === 'FLASH') {
          if (i.expr !== 4) fail(name + ': на вході у FLASH вираз ' + i.expr + ', а не 4');
          if (shots) await page.screenshot({ path: path.join(shotDir, size + '-flash.png') });
        }
        if (name === 'optimal' && node === 'N1') await page.screenshot({ path: path.join(shotDir, size + '-node.png') });
        const idx = LETTERS.indexOf(letter);
        if (p.input === 'keys') await page.keyboard.press(String(idx + 1));
        else await page.click('.option[data-letter="' + letter + '"]');
        i = await checkLayout(page, size + ' ' + name + ' ' + node + ' реакція');
        if (i.screen !== 'reply') fail(name + ' ' + node + ': немає екрана реакції');
        got.push(node + ' ' + letter + ' (' + i.expr + ')');
        if (i.expr !== Number(want)) fail(name + ' ' + node + ' ' + letter + ': вираз ' + i.expr + ', очікувався ' + want);
        if (name === 'optimal' && node === 'N3') await page.screenshot({ path: path.join(shotDir, size + '-reply.png') });
        await next(page, k % 3 === 0 ? 'click' : (k % 3 === 1 ? 'Enter' : ' '));
        if (p.walkoutAfter === node) {
          i = await checkLayout(page, size + ' обрив');
          if (i.screen !== 'walkout' || i.expr !== 3) fail(name + ': сцена обриву ' + JSON.stringify(i));
          else got[got.length - 1] = node + ' ' + letter + ' (' + want + ', обрив ' + i.expr + ')';
          if (shots) await page.screenshot({ path: path.join(shotDir, size + '-walkout.png') });
          await next(page, 'Enter');
        }
        i = await info(page);
        if (i.screen === 'session2') {
          await checkLayout(page, size + ' вхід у сесію 2');
          if (name === 'flash_walkout') await page.screenshot({ path: path.join(shotDir, size + '-session2.png') });
          await next(page, 'Enter');
        }
      }
      let i = await checkLayout(page, size + ' ' + name + ' епілог');
      const title = await page.textContent('.ending-title').catch(() => '');
      if (i.screen !== 'epilogue') fail(name + ': немає епілогу, екран ' + i.screen);
      if (shots || name === 'e4') await page.screenshot({ path: path.join(shotDir, size + '-epilogue-' + p.ending + '.png') });
      await next(page, 'Enter');
      i = await info(page);
      const endCode = (await page.textContent('.summary .ending-title')).slice(0, 2);
      if (i.screen !== 'debrief') fail(name + ': немає екрана розбору');
      if (endCode !== p.ending) fail(name + ': фінал ' + endCode + ', очікувався ' + p.ending);
      console.log(name + ': ' + got.join(', ') + ', фінал ' + endCode + ' (' + title + ')');
      if (i.hscroll) fail(size + ' ' + name + ': горизонтальна прокрутка на розборі');
      if (shots || name === 'e4') {
        await page.screenshot({ path: path.join(shotDir, size + '-debrief-' + p.ending + '.png') });
        if (name === 'optimal') await page.screenshot({ path: path.join(shotDir, size + '-debrief-' + p.ending + '-full.png'), fullPage: true });
      }
      // Почати знову
      await page.click('[data-action="restart"]');
      i = await info(page);
      if (i.screen !== 'intro' || i.expr !== 1) fail('«Почати знову» не повертає на вступ');
    }

    // Обрізаний текст: кожен вузол, кожен варіант і обидві гілки умов хоча б раз
    let checked = 0;
    for (const cp of coverPaths) {
      await page.goto(url);
      for (let k = 0; k < 4; k++) await page.keyboard.press('Enter');
      for (const s of cp) {
        let i = await info(page);
        while (i.screen !== 'node') {
          await checkLayout(page, size + ' ' + i.screen);
          await page.keyboard.press('Enter');
          i = await info(page);
        }
        await checkLayout(page, size + ' вузол ' + s.node);
        await page.keyboard.press(String(s.idx + 1));
        await checkLayout(page, size + ' реакція ' + s.node + ' ' + LETTERS[s.idx]);
        checked++;
        await page.keyboard.press('Enter');
      }
      await checkLayout(page, size + ' кінець шляху');
    }
    console.log('перевірено на обрізаний текст: ' + coverPaths.length + ' шляхів, ' + checked + ' виборів, ' +
      'покрито ' + coverKeys.size + ' варіантів і гілок умов');
    if (errors.length) fail('помилки JS: ' + errors.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + (failures ? 'НЕ ПРОЙДЕНО: помилок ' + failures : 'УСЕ ПРОЙДЕНО'));
  process.exit(failures ? 1 : 0);
})();

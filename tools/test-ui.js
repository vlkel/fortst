#!/usr/bin/env node
// Перевірка index.html у headless Chromium (Playwright, не є залежністю проєкту).
// Запуск: NODE_PATH=$(npm root -g) node tools/test-ui.js [папка для скрінів]
//
// 1. Контрольні шляхи в 1280x720 і 1920x1080: кожен екран (фрагмент, меню, заставка) у правильному
//    порядку з правильним виразом обличчя (очікуване рахує рушій, звірений з reference/engine.py),
//    макет (голова над текстовим полем, текст у полі, меню над полем, без прокрутки, цілі шрифти), скріни.
// 2. Кожен фрагмент сценарію і кожне меню вміщаються в обох розмірах вікна.
// 3. Кнопка «Назад»: 30 випадкових шляхів з 1-2 поверненнями через меню з іншим вибором, плюс повернення
//    через флешбек, N6B, сцену обриву, вхід у другу сесію і епілог. Кінцевий стан і екран розбору
//    мають збігтися з тим самим шляхом без повернень.
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { createEngine, fragments } = require('../engine.js');

const root = path.join(__dirname, '..');
const url = 'file://' + path.join(root, 'index.html');
const shotDir = process.argv[2] || path.join(root, 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });

const SC = JSON.parse(fs.readFileSync(path.join(root, 'data', 'scenario.json'), 'utf8'));
const ENG = createEngine(SC);
const LETTERS = ['А', 'Б', 'В'];
const VIEWPORTS = [[1280, 720], [1920, 1080]];

const PATHS = {
  optimal: { steps: 'N1В N2Б N3Б N4В N5А N6А N6BВ N7А N8В N9А N10А N11Б', ending: 'E1', input: 'click' },
  flash_walkout: { steps: 'N1А N2В N3В N4А N5Б FLASHА N6А N7А N8А N9А N10А N11А', input: 'keys' },
  e4: { steps: 'N1А N2А N3А N4А N5Б N6В N7Б N8Б N9А N10Б N11А', ending: 'E4', input: 'click' }
};

let failures = 0;
function fail(msg) { failures++; if (failures <= 60) console.log('  ПОМИЛКА: ' + msg); }

// Мулберрі32: відтворюваний випадковий генератор
function rng(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Очікувана послідовність екранів для шляху (індекси варіантів): незалежна модель черги екранів
function expectScreens(idxs) {
  const st = ENG.newState();
  const out = [];
  const text = (t, face, ctx, node) => fragments(t).forEach(f => out.push({ type: 'text', kind: f.kind, text: f.text, face, ctx, node: node || '' }));
  const enter = id => {
    const n = ENG.NODE[id];
    text(n.narration, st.narr_face, 'narration', id);
    text(ENG.situation(id, st), st.face, 'situation', id);
    out.push({ type: 'menu', node: id, face: st.face, text: out[out.length - 1].text });
  };
  out.push({ type: 'title', text: 'Перша зустріч' });
  SC.intro.forEach(t => text(t, 1, 'intro'));
  let cur = 'N1';
  enter(cur);
  for (const idx of idxs) {
    const r = ENG.step(st, cur, idx);
    text(r.reply, r.expr, 'reply', cur);
    if (r.walkout) text(SC.walkout.text, r.walkoutFace, 'walkout');
    if (r.session2) {
      out.push({ type: 'title', text: 'Друга зустріч через тиждень' });
      text(SC.session2_entry[r.session2].text, r.session2Face, 'session2');
    }
    cur = r.next;
    if (cur === null) break;
    enter(cur);
  }
  if (cur !== null) throw new Error('шлях не дійшов до епілогу');
  const end = ENG.ending(st);
  out.push({ type: 'title', text: 'Через місяць' });
  text(SC.endings[end].text, SC.endings[end].expr, 'epilogue');
  out.push({ type: 'debrief', face: SC.endings[end].expr });
  return { screens: out, ending: end, state: st };
}

function parsePath(steps) {
  return steps.split(' ').map(p => LETTERS.indexOf(p.slice(-1)));
}

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
    const r = el => { if (!el) return null; const q = el.getBoundingClientRect(); return { top: q.top, bottom: q.bottom, left: q.left, right: q.right, h: q.height, w: q.width }; };
    const L = window.__novel.layout();
    const line = document.querySelector('.textbox .line');
    const de = document.documentElement;
    // Шрифти: усі видимі елементи мають цілий розмір шрифту
    const badFonts = [];
    document.querySelectorAll('body *').forEach(el => {
      const fsz = parseFloat(getComputedStyle(el).fontSize);
      if (!Number.isInteger(fsz) && badFonts.length < 3) badFonts.push(el.className + ' ' + fsz);
    });
    const portrait = document.querySelector('.portrait');
    return {
      type: b.dataset.screen, expr: b.dataset.expr ? Number(b.dataset.expr) : null, node: b.dataset.node,
      ctx: b.dataset.ctx, kind: b.dataset.kind,
      portraitExpr: portrait ? Number(portrait.dataset.expr) : null,
      text: line ? line.textContent : null,
      title: document.querySelector('.title-card h1') ? document.querySelector('.title-card h1').textContent : null,
      nameplate: !!document.querySelector('.nameplate'),
      nameplateRect: r(document.querySelector('.nameplate')),
      lineRect: r(line), boxRect: r(document.querySelector('.textbox')),
      portraitRect: r(portrait), menuRect: r(document.querySelector('.menu')),
      options: document.querySelectorAll('.option').length,
      dim: !!document.querySelector('.dim'),
      L: L,
      vscroll: b.dataset.screen !== 'debrief' && de.scrollHeight > window.innerHeight + 1,
      hscroll: de.scrollWidth > window.innerWidth + 1,
      back: !!document.querySelector('[data-action="back"]'),
      hist: window.__novel.historyLength(),
      badFonts: badFonts
    };
  });
}

// Перевірка макета і (якщо задано) відповідності очікуваному екрану
function checkInfo(i, where, want) {
  if (want) {
    if (i.type !== want.type) { fail(where + ': очікувався екран ' + want.type + ', а показано ' + i.type); return false; }
    if (want.type === 'text' || want.type === 'menu') {
      if (i.expr !== want.face || i.portraitExpr !== want.face) fail(where + ': вираз ' + i.portraitExpr + ', очікувався ' + want.face);
      if (i.text !== want.text) fail(where + ': текст «' + i.text + '», очікувався «' + want.text + '»');
      if (want.node && i.node !== want.node) fail(where + ': вузол ' + i.node + ', очікувався ' + want.node);
    }
    if (want.type === 'text') {
      if (i.kind !== want.kind) fail(where + ': вид фрагмента ' + i.kind + ', очікувався ' + want.kind);
      if (i.nameplate !== (want.kind === 'speech')) fail(where + ': плашка імені ' + (i.nameplate ? 'є' : 'немає') + ' на ' + want.kind);
    }
    if (want.type === 'title' && i.title !== want.text) fail(where + ': заставка «' + i.title + '», очікувалась «' + want.text + '»');
    if (want.type === 'debrief' && i.expr !== want.face) fail(where + ': вираз фіналу ' + i.expr);
  }
  if (i.hscroll) fail(where + ': горизонтальна прокрутка');
  if (i.vscroll) fail(where + ': вертикальна прокрутка');
  if (i.badFonts.length) fail(where + ': дробові розміри шрифту ' + i.badFonts.join('; '));
  if (i.type === 'text' || i.type === 'menu') {
    const L = i.L, box = i.boxRect;
    // голова з шиєю над текстовим полем
    if (L.headBottom > box.top) fail(where + ': голова перекрита полем (низ голови ' + L.headBottom + ', поле ' + box.top + ')');
    if (i.portraitRect.top < 0) fail(where + ': портрет обрізано зверху');
    if (Math.abs(i.portraitRect.h - L.portraitH) > 1) fail(where + ': висота портрета ' + i.portraitRect.h);
    if (Math.abs(i.portraitRect.left + i.portraitRect.right - 2 * L.vw / 2) > 2) fail(where + ': портрет не по центру');
    if (Math.abs(box.h - L.boxH) > 0.5) fail(where + ': висота поля ' + box.h + ' замість ' + L.boxH);
    if (i.lineRect.bottom > box.bottom - L.fs * 0.5) fail(where + ': текст не вміщається в поле');
    if (i.nameplateRect && Math.abs(i.nameplateRect.bottom - box.top) > 1) fail(where + ': плашка не над полем');
  }
  if (i.type === 'menu') {
    if (i.options !== 3 || !i.dim) fail(where + ': меню без трьох варіантів або без затемнення');
    if (i.menuRect.top < 0 || i.menuRect.bottom > i.boxRect.top) fail(where + ': меню не вміщається над полем (' +
      Math.round(i.menuRect.top) + '..' + Math.round(i.menuRect.bottom) + ', поле ' + i.boxRect.top + ')');
  }
  return true;
}

async function forward(page, i, input) {
  if (i.type === 'menu') throw new Error('forward на меню');
  if (input === 'click') await page.mouse.click(Math.round(i.L.vw / 2), Math.round(i.L.vh / 3));
  else await page.keyboard.press(Math.random() < 0.5 ? 'Space' : 'Enter');
}

async function choose(page, idx, input) {
  if (input === 'click') await page.click('.option[data-letter="' + LETTERS[idx] + '"]');
  else await page.keyboard.press(String(idx + 1));
}

// Пройти шлях уперед до розбору, без перевірок (швидко)
async function playFast(page, idxs, from) {
  let k = from || 0;
  for (let guard = 0; guard < 1000; guard++) {
    const t = await page.evaluate(() => document.body.dataset.screen);
    if (t === 'debrief') return;
    if (t === 'menu') await page.keyboard.press(String(idxs[k++] + 1));
    else await page.keyboard.press('Space');
  }
  throw new Error('шлях не завершився');
}

async function debriefText(page) {
  return page.evaluate(() => {
    document.querySelectorAll('details.step').forEach(d => { d.open = true; });
    return document.querySelector('.debrief').innerText;
  });
}

async function finalSnapshot(page) {
  return {
    state: await page.evaluate(() => window.__novel.state()),
    debrief: await debriefText(page)
  };
}

const SHOTS = {
  intro: (s, i, k) => s.ctx === 'intro' && k === 3,
  narration: (s, i) => s.ctx === 'narration' && s.node === 'N2',
  speech: (s, i) => s.ctx === 'situation' && s.node === 'N5',
  menu: (s, i) => s.type === 'menu' && s.node === 'N5',
  'reply-remark': (s, i, k, all) => s.ctx === 'reply' && s.kind === 'narr' && s.node === 'N1',
  flash: (s) => s.ctx === 'situation' && s.node === 'FLASH',
  walkout: (s) => s.ctx === 'walkout' && s.kind === 'speech',
  'title-session2': (s) => s.type === 'title' && s.text === 'Друга зустріч через тиждень',
  'session2-entry': (s) => s.ctx === 'session2',
  epilogue: (s) => s.ctx === 'epilogue'
};

async function runControl(browser) {
  console.log('1. Контрольні шляхи: кожен екран, вираз, текст, макет');
  for (const [w, hgt] of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: w, height: hgt } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    for (const name of Object.keys(PATHS)) {
      const p = PATHS[name];
      const idxs = parsePath(p.steps);
      const exp = expectScreens(idxs);
      if (p.ending && exp.ending !== p.ending) fail(name + ': рушій дає ' + exp.ending + ', очікувався ' + p.ending);
      await page.goto(url);
      let k = 0, choice = 0, checked = 0;
      const taken = {};
      for (const want of exp.screens) {
        const where = w + 'x' + hgt + ' ' + name + ', екран ' + (k + 1);
        const i = await info(page);
        if (!checkInfo(i, where, want)) break;
        if (k === 0 && i.back) fail(where + ': на першому екрані є «Назад»');
        if (k > 0 && !i.back) fail(where + ': немає «Назад»');
        checked++;
        for (const shot of Object.keys(SHOTS)) {
          if (!taken[shot] && SHOTS[shot](want, i, k)) {
            taken[shot] = true;
            await page.screenshot({ path: path.join(shotDir, w + 'x' + hgt + '-' + shot + '.png') });
          }
        }
        if (want.type === 'debrief') break;
        if (want.type === 'menu') await choose(page, idxs[choice++], p.input);
        else await forward(page, i, p.input);
        k++;
      }
      // Розбір
      const d = await page.evaluate(() => ({
        title: document.querySelector('.ending-title').textContent,
        steps: document.querySelectorAll('details.step').length,
        good: document.querySelectorAll('.list-good li').length,
        other: document.querySelectorAll('.list-other li').length,
        links: Array.from(document.querySelectorAll('.evidence a')).map(a => a.href),
        h2: Array.from(document.querySelectorAll('.debrief h2')).map(x => x.textContent),
        scroll: document.documentElement.scrollHeight > window.innerHeight,
        bad: Array.from(document.querySelectorAll('.debrief *')).filter(el => !Number.isInteger(parseFloat(getComputedStyle(el).fontSize))).length
      }));
      if (!d.title.startsWith(exp.ending + '.')) fail(name + ': на розборі ' + d.title + ', очікувався ' + exp.ending);
      if (d.steps !== idxs.length || d.good + d.other !== idxs.length) fail(name + ': у розборі не всі кроки');
      if (d.links.length !== SC.debrief_common.evidence.length) fail(name + ': не всі посилання доказової бази');
      if (d.bad) fail(name + ': на розборі дробові шрифти: ' + d.bad);
      if (!d.scroll) fail(name + ': розбір не прокручується');
      const H2 = ['Що сталося', 'Що вдалося', 'Що варто було зробити інакше', 'Як варто було діяти', 'Хронологія',
        'Прапорці і ризик', 'Доказова база', 'Інші можливі фінали'];
      if (d.h2.join('|') !== H2.join('|')) fail(name + ': розділи розбору ' + d.h2.join(', '));
      // оцінки й тексти розбору за pick(spec, branch)
      const want = ENG.cloneState(exp.state).log.map(e => {
        const a = ENG.NODE[e.node].options[e.idx].analysis;
        return { grade: ENG.pick(a.grade, e.branch), result: ENG.pick(a.result, e.branch), better: e.grade !== 'good' ? a.better : null };
      });
      const got = await page.evaluate(() => Array.from(document.querySelectorAll('details.step')).map(s => {
        const b = s.querySelector('.badge');
        const hs = Array.from(s.querySelectorAll('.body h3'));
        const after = t => { const x = hs.find(q => q.textContent === t); return x ? x.nextElementSibling.textContent : null; };
        return { grade: b.className.replace('badge ', ''), result: after('До чого це призвело'), better: after('Кращий варіант') };
      }));
      want.forEach((wnt, j) => {
        if (got[j].grade !== wnt.grade || got[j].result !== wnt.result || got[j].better !== wnt.better) {
          fail(name + ': розбір кроку ' + (j + 1) + ' ' + JSON.stringify(got[j]) + ' замість ' + JSON.stringify(wnt));
        }
      });
      if (name === 'flash_walkout' || name === 'optimal') {
        await page.screenshot({ path: path.join(shotDir, w + 'x' + hgt + '-debrief-top-' + name + '.png') });
        await page.evaluate(() => {
          const s = document.querySelectorAll('details.step')[0];
          s.querySelector('summary').click();
          window.scrollTo(0, s.getBoundingClientRect().top + window.scrollY - 20);
        });
        await page.screenshot({ path: path.join(shotDir, w + 'x' + hgt + '-debrief-step-' + name + '.png') });
        // «Розгорнути все»
        await page.click('[data-action="expand-all"]');
        const open = await page.evaluate(() => document.querySelectorAll('details.step[open]').length);
        if (open !== idxs.length) fail(name + ': «Розгорнути все» відкрило ' + open + ' з ' + idxs.length);
      }
      const shotNames = Object.keys(SHOTS).filter(s => taken[s]);
      console.log('  ' + w + 'x' + hgt + ' ' + name + ': ' + exp.ending + ', екранів перевірено ' + checked + ' з ' + exp.screens.length +
        ', скріни: ' + (shotNames.join(', ') || 'немає'));
    }
    if (errors.length) fail(w + 'x' + hgt + ': помилки JS: ' + errors.join('; '));
    await page.close();
  }
}

// Кожен фрагмент і кожне меню в обох розмірах вікна
async function runAllTexts(browser) {
  console.log('\n2. Усі фрагменти і всі меню вміщаються');
  const texts = [].concat(SC.intro);
  SC.nodes.forEach(n => {
    texts.push(n.narration, n.situation);
    (n.situation_by_Z || []).forEach(r => texts.push(r[2]));
    n.options.forEach(o => texts.push(o.reply, o.reply_then, o.reply_else));
  });
  texts.push(SC.walkout.text);
  Object.values(SC.session2_entry).forEach(x => texts.push(x.text));
  Object.values(SC.endings).forEach(x => texts.push(x.text));
  const frs = [];
  texts.filter(Boolean).forEach(t => fragments(t).forEach(f => frs.push(f)));
  for (const [w, hgt] of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: w, height: hgt } });
    await page.goto(url);
    // дійти до першого меню, далі підміняти текст у полі і варіанти меню
    for (let g = 0; g < 20; g++) {
      if (await page.evaluate(() => document.body.dataset.screen) === 'menu') break;
      await page.keyboard.press('Space');
    }
    const res = await page.evaluate(({ frs, nodes }) => {
      const L = window.__novel.layout();
      const box = document.querySelector('.textbox');
      const line = box.querySelector('.line');
      let worst = 0, over = [];
      frs.forEach(f => {
        line.className = 'line ' + f.kind;
        line.textContent = f.text;
        const gap = box.getBoundingClientRect().bottom - line.getBoundingClientRect().bottom;
        if (gap < L.fs * 0.5) over.push(f.text.slice(0, 40));
        worst = Math.max(worst, line.getBoundingClientRect().height);
      });
      const menu = document.querySelector('.menu');
      const menuOver = [];
      let menuMax = 0;
      nodes.forEach(n => {
        const spans = menu.querySelectorAll('.opt-text');
        n.opts.forEach((t, i) => { spans[i].textContent = t; });
        const r = menu.getBoundingClientRect();
        menuMax = Math.max(menuMax, r.height);
        if (r.top < 0 || r.bottom > box.getBoundingClientRect().top) menuOver.push(n.id);
      });
      return { over, menuOver, worst: Math.round(worst), boxH: L.boxH, menuMax: Math.round(menuMax), fs: L.fs, space: L.vh - L.boxH };
    }, { frs, nodes: SC.nodes.map(n => ({ id: n.id, opts: n.options.map(o => o.text) })) });
    console.log('  ' + w + 'x' + hgt + ': шрифт ' + res.fs + ' px, фрагментів ' + frs.length + ', не вміщаються ' + res.over.length +
      ' (найвищий ' + res.worst + ' px, поле ' + res.boxH + ' px); меню ' + SC.nodes.length + ', не вміщаються ' + res.menuOver.length +
      ' (найвище ' + res.menuMax + ' px з ' + res.space + ' px над полем)');
    res.over.forEach(t => fail(w + 'x' + hgt + ': фрагмент не вміщається: ' + t));
    res.menuOver.forEach(t => fail(w + 'x' + hgt + ': меню ' + t + ' не вміщається'));
    await page.close();
  }
}

// Натискати Backspace, доки не з'явиться меню вузла node; повертає кількість натискань
async function backToMenu(page, node) {
  for (let n = 1; n <= 400; n++) {
    await page.keyboard.press('Backspace');
    const s = await page.evaluate(() => ({ t: document.body.dataset.screen, n: document.body.dataset.node }));
    if (s.t === 'menu' && s.n === node) return n;
  }
  throw new Error('не вдалося повернутися до меню ' + node);
}

// Дійти до меню з номером k (0 = N1) на шляху idxs; повертає стан на цьому меню
async function goToMenu(page, idxs, k) {
  let m = 0;
  for (let guard = 0; guard < 1000; guard++) {
    const s = await page.evaluate(() => document.body.dataset.screen);
    if (s === 'menu') {
      if (m === k) return page.evaluate(() => window.__novel.state());
      await page.keyboard.press(String(idxs[m++] + 1));
    } else {
      await page.keyboard.press('Space');
    }
  }
  throw new Error('не дійшли до меню ' + k);
}

// Пройти вперед на n екранів або до потрібного екрана (pred), не далі розбору
async function advance(page, idxs, from, n, pred) {
  let m = from;
  for (let j = 0; j < n; j++) {
    const s = await page.evaluate(() => ({ t: document.body.dataset.screen, ctx: document.body.dataset.ctx, n: document.body.dataset.node, title: (document.querySelector('.title-card h1') || {}).textContent }));
    if (pred && pred(s)) return { m, hit: true };
    if (s.t === 'debrief') return { m, hit: false };
    if (s.t === 'menu') await page.keyboard.press(String(idxs[m++] + 1));
    else await page.keyboard.press('Space');
  }
  return { m, hit: false };
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function runBack(browser) {
  console.log('\n3. Кнопка «Назад»');
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const rand = rng(20261009);
  const straight = {};
  async function reference(idxs) {
    const key = idxs.join('');
    if (!straight[key]) {
      await page.goto(url);
      await playFast(page, idxs);
      straight[key] = await finalSnapshot(page);
    }
    return straight[key];
  }

  let ok = 0, returns = 0, backs = 0;
  for (let t = 0; t < 30; t++) {
    const idxs = randomPath(rand);
    const ref = await reference(idxs);
    await page.goto(url);
    const nRet = 1 + Math.floor(rand() * 2);
    const ks = [];
    while (ks.length < nRet) {
      const k = Math.floor(rand() * idxs.length);
      if (ks.indexOf(k) < 0) ks.push(k);
    }
    ks.sort((a, b) => a - b);
    let m = 0, good = true;
    for (const k of ks) {
      // дійти до меню k, запам'ятати стан, обрати інший варіант, піти вперед, повернутися
      const node = await page.evaluate(() => document.body.dataset.node);
      let atMenu;
      {
        let mm = m;
        for (let guard = 0; guard < 1000; guard++) {
          const s = await page.evaluate(() => document.body.dataset.screen);
          if (s === 'menu') {
            if (mm === k) break;
            await page.keyboard.press(String(idxs[mm++] + 1));
          } else await page.keyboard.press('Space');
        }
        atMenu = await page.evaluate(() => ({ st: window.__novel.state(), node: document.body.dataset.node, hist: window.__novel.historyLength() }));
        m = mm;
      }
      const other = (idxs[k] + 1 + Math.floor(rand() * 2)) % 3;
      await page.keyboard.press(String(other + 1));
      // інший шлях після іншого вибору: вперед на 1-25 екранів своїми виборами
      const alt = randomPath(rand);
      let steps = 1 + Math.floor(rand() * 25);
      for (let j = 0; j < steps; j++) {
        const s = await page.evaluate(() => document.body.dataset.screen);
        if (s === 'debrief') break;
        if (s === 'menu') await page.keyboard.press(String(alt[j % alt.length] + 1));
        else await page.keyboard.press('Space');
      }
      backs += await backToMenu(page, atMenu.node);
      returns++;
      const now = await page.evaluate(() => ({ st: window.__novel.state(), hist: window.__novel.historyLength() }));
      if (!same(now.st, atMenu.st) || now.hist !== atMenu.hist) {
        good = false;
        fail('шлях ' + (t + 1) + ': після повернення до меню ' + atMenu.node + ' стан не той самий');
      }
    }
    await playFast(page, idxs, m);
    const fin = await finalSnapshot(page);
    if (!same(fin.state, ref.state)) { good = false; fail('шлях ' + (t + 1) + ': кінцевий стан відрізняється від шляху без повернень'); }
    if (fin.debrief !== ref.debrief) { good = false; fail('шлях ' + (t + 1) + ': екран розбору відрізняється'); }
    if (good) ok++;
  }
  console.log('  випадкових шляхів: 30, повернень через меню з іншим вибором: ' + returns + ', натискань «Назад»: ' + backs +
    ', збіглося з шляхом без повернень: ' + ok + ' з 30');

  // Окремі повернення через особливі екрани
  const SPECIAL = [
    { name: 'флешбек', steps: 'N1А N2В N3В N4А N5Б FLASHА N6А N7А N8А N9А N10А N11А', pred: s => s.n === 'FLASH' && s.t === 'text', menu: 'N5' },
    { name: 'N6B', steps: 'N1В N2Б N3Б N4В N5А N6А N6BВ N7А N8В N9А N10А N11Б', pred: s => s.n === 'N6B' && s.t === 'text', menu: 'N6' },
    { name: 'сцена обриву', steps: 'N1А N2В N3В N4А N5Б FLASHА N6А N7А N8А N9А N10А N11А', pred: s => s.ctx === 'walkout', menu: null },
    { name: 'вхід у другу сесію', steps: 'N1В N2Б N3Б N4В N5А N6А N6BВ N7А N8В N9А N10А N11Б', pred: s => s.ctx === 'session2', menu: 'N8' },
    { name: 'заставка другої сесії', steps: 'N1В N2Б N3Б N4В N5А N6А N6BВ N7А N8В N9А N10А N11Б', pred: s => s.t === 'title' && s.title === 'Друга зустріч через тиждень', menu: 'N8' },
    { name: 'епілог', steps: 'N1А N2А N3А N4А N5Б N6В N7Б N8Б N9А N10Б N11А', pred: s => s.ctx === 'epilogue', menu: 'N11' },
    { name: 'розбір', steps: 'N1А N2А N3А N4А N5Б N6В N7Б N8Б N9А N10Б N11А', pred: s => s.t === 'debrief', menu: 'N11' }
  ];
  for (const sp of SPECIAL) {
    const idxs = parsePath(sp.steps);
    const ref = await reference(idxs);
    await page.goto(url);
    // знайти меню, після якого з'являється особливий екран
    const exp = expectScreens(idxs).screens;
    let menuNode = sp.menu;
    if (!menuNode) {
      const at = exp.findIndex(s => s.ctx === 'walkout');
      for (let j = at; j >= 0; j--) if (exp[j].type === 'menu') { menuNode = exp[j].node; break; }
    }
    const menuIdx = exp.filter(s => s.type === 'menu').findIndex(s => s.node === menuNode);
    const atMenu = await goToMenu(page, idxs, menuIdx);
    const r = await advance(page, idxs, menuIdx, 200, sp.pred);
    if (!r.hit) { fail(sp.name + ': екран не знайдено'); continue; }
    const before = await page.evaluate(() => window.__novel.state());
    const n = await backToMenu(page, menuNode);
    const back = await page.evaluate(() => window.__novel.state());
    let good = same(back, atMenu);
    if (!good) fail(sp.name + ': після повернення до меню ' + menuNode + ' стан не той самий');
    // іншим вибором уперед, знову назад і до кінця тим самим шляхом
    await page.keyboard.press(String((idxs[menuIdx] + 1) % 3 + 1));
    await page.keyboard.press('Space');
    await backToMenu(page, menuNode);
    await playFast(page, idxs, menuIdx);
    const fin = await finalSnapshot(page);
    if (!same(fin.state, ref.state) || fin.debrief !== ref.debrief) { good = false; fail(sp.name + ': фінал не збігся з шляхом без повернень'); }
    const flag = { 'флешбек': 'flash_done', 'сцена обриву': 'walkout' }[sp.name];
    if (flag && (!before.flags[flag] || back.flags[flag])) { good = false; fail(sp.name + ': прапорець ' + flag + ' не скасовано'); }
    if ((sp.name.indexOf('друг') >= 0 || sp.name === 'сцена обриву') && (before.session !== 2 || back.session !== 1)) { good = false; fail(sp.name + ': сесію не скасовано'); }
    console.log('  повернення через ' + sp.name + ': ' + n + ' кроків назад до меню ' + menuNode + ', стан ' + (good ? 'відновлено, фінал збігся' : 'НЕ відновлено'));
  }
  // «Назад» по одному фрагменту: кожне натискання повертає рівно попередній екран
  {
    const idxs = parsePath(PATHS.optimal.steps);
    await page.goto(url);
    const seen = [];
    for (let j = 0; j < 40; j++) {
      seen.push(await page.evaluate(() => JSON.stringify(window.__novel.screen())));
      const s = await page.evaluate(() => document.body.dataset.screen);
      if (s === 'menu') await page.keyboard.press(String(idxs[seen.filter(x => JSON.parse(x).type === 'menu').length - 1] + 1));
      else await page.keyboard.press('Space');
    }
    let okSteps = 0;
    for (let j = seen.length - 1; j >= 0; j--) {
      await page.click('[data-action="back"]').catch(() => page.keyboard.press('Backspace'));
      const cur = await page.evaluate(() => JSON.stringify(window.__novel.screen()));
      if (cur === seen[j]) okSteps++;
      else { fail('«Назад» по фрагментах: крок ' + j + ' не збігся'); break; }
    }
    const hasBack = await page.evaluate(() => !!document.querySelector('[data-action="back"]'));
    if (hasBack) fail('на першому екрані є «Назад»');
    console.log('  «Назад» по одному фрагменту (кнопкою): ' + okSteps + ' з ' + seen.length + ' екранів назад точно попередні');
  }
  if (errors.length) fail('помилки JS: ' + errors.join('; '));
  await page.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    await runControl(browser);
    await runAllTexts(browser);
    await runBack(browser);
  } finally {
    await browser.close();
  }
  console.log('\n' + (failures ? 'НЕ ПРОЙДЕНО: помилок ' + failures : 'УСЕ ПРОЙДЕНО'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

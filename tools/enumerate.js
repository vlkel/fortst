#!/usr/bin/env node
// Повний перебір усіх шляхів рушієм engine.js у форматі reference/enumerate_paths.py:
// шлях<TAB>фінал<TAB>D,Z,S<TAB>R<TAB>послідовність облич.
// Послідовність облич: на вході в N1 narr_face/face, далі для кожного вибору after_choice,
// потім (якщо є сцена обриву) W<обличчя>, потім на вході в наступний вузол narr_face/face.
// Порядок шляхів: А, Б, В у кожній розвилці.
// Запуск: node tools/enumerate.js > js_paths.txt
'use strict';
const fs = require('fs');
const path = require('path');
const { createEngine } = require('../engine.js');

const root = path.join(__dirname, '..');
const scenario = JSON.parse(fs.readFileSync(path.join(root, 'data', 'scenario.json'), 'utf8'));
const E = createEngine(scenario);

// Обхід у глибину з колбеком на кожен повний шлях; потрібен і тестам
function enumerate(onPath) {
  function dfs(st, node, trail, faces) {
    for (let i = 0; i < 3; i++) {
      const s = E.cloneState(st);
      const r = E.step(s, node, i);
      const p = trail.concat(node + E.NODE[node].options[i].letter);
      const fc = faces.concat(String(r.expr));
      if (r.walkout) fc.push('W' + r.walkoutFace);
      if (r.next === null) {
        onPath(s, p, fc);
      } else {
        fc.push(s.narr_face + '/' + s.face);
        dfs(s, r.next, p, fc);
      }
    }
  }
  const st = E.newState();
  dfs(st, 'N1', [], [st.narr_face + '/' + st.face]);
}

function line(s, p, fc) {
  return [p.join(' '), E.ending(s), s.D + ',' + s.Z + ',' + s.S, String(E.risk(s)), fc.join(' ')].join('\t');
}

if (require.main === module) {
  const chunks = [];
  enumerate((s, p, fc) => { chunks.push(line(s, p, fc)); });
  process.stdout.write(chunks.join('\n') + '\n');
}

module.exports = { enumerate: enumerate, line: line };

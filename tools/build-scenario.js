#!/usr/bin/env node
// Генерує scenario.js (window.SCENARIO = {...}) з data/scenario.json.
// Потрібно, бо index.html відкривається через file://, де fetch не працює.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'data', 'scenario.json');
const dst = path.join(root, 'scenario.js');

const data = JSON.parse(fs.readFileSync(src, 'utf8'));
const out = '// Згенеровано tools/build-scenario.js з data/scenario.json. Не редагувати вручну.\n' +
  'window.SCENARIO = ' + JSON.stringify(data, null, 1) + ';\n';
fs.writeFileSync(dst, out, 'utf8');
console.log('scenario.js: ' + data.nodes.length + ' вузлів, ' + Buffer.byteLength(out) + ' байт');

// Рушій новели «Третя доба». Без DOM, точно повторює reference/engine.py (версія 3: 15 виразів).
// У браузері: window.Engine = createEngine(window.SCENARIO).
// У Node: require('./engine.js').createEngine(scenario), require('./engine.js').fragments(text).
(function (root) {
  'use strict';

  var SPINE1 = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8'];
  var SPINE2 = ['N9', 'N10', 'N11'];
  var FLASH_FROM = { N3: 1, N4: 1, N5: 1, N6: 1, N7: 1 };   // після цих вузлів можливий флешбек
  var COUNTERS = { retrauma: 1, avoid: 1 };

  function clamp(v) {
    return Math.max(0, Math.min(10, v));
  }

  function scales(st) {
    return { D: st.D, Z: st.Z, S: st.S };
  }

  // Умова варіанта перевіряється за шкалами до вибору (before), умова виразу за станом після.
  function check(cond, st, before) {
    if (cond.indexOf('flag:') === 0) {
      return !!st.flags[cond.slice(5)];
    }
    var m = /^([DZS])(>=|<=)(\d+)$/.exec(cond);
    if (!m) throw new Error('Невідома умова: ' + cond);
    var v = (before || st)[m[1]];
    var n = parseInt(m[3], 10);
    return m[2] === '>=' ? v >= n : v <= n;
  }

  function apply(eff, st) {
    if (!eff) return;
    ['D', 'Z', 'S'].forEach(function (k) {
      if (k in eff) st[k] = clamp(st[k] + eff[k]);
    });
    (eff.set || []).forEach(function (f) { st.flags[f] = true; });
    (eff.inc || []).forEach(function (f) { st.flags[f] = (st.flags[f] || 0) + 1; });
  }

  // Граф дозволених переходів виразів за один екран (залишитися в тому самому можна завжди)
  var GRAPH = {
    1: [2, 4, 5, 9, 10, 12, 13, 14, 15],      // закритий
    2: [1, 4, 5, 7, 9, 13],                   // скептичний
    3: [1, 4, 5, 10],                         // гнів, агресія: лише після 5
    4: [1, 2, 5, 9, 10, 12, 13, 14],          // стримана фрустрація, втомлено-похмурий
    5: [1, 2, 3, 4, 7, 8, 9, 12, 13, 14],     // напруження, роздратування, настороженість
    6: [5, 8, 9, 12, 13],                     // відсутній погляд
    7: [2, 5, 6, 8, 13],                      // гіпернастороженість
    8: [1, 2, 5, 6, 7, 9, 13, 14],            // тривога, придушена паніка
    9: [1, 2, 4, 5, 10, 11, 12, 13],          // сором, погляд униз
    10: [4, 9, 11, 12, 13],                   // провина
    11: [4, 5, 9, 10, 12, 13, 14],            // сум, стримані сльози
    12: [1, 4, 5, 6, 9, 13],                  // глибока втома
    13: [1, 2, 9, 10, 11, 14, 15],            // осмислення
    14: [1, 2, 5, 11, 12, 13, 15],            // полегшення
    15: [1, 2, 5, 9, 11, 13, 14]              // обережна довіра
  };
  // Сильні вирази (гнів, дисоціація, паніка, сльози) не бувають проміжним кроком
  var STRONG = { 3: 1, 6: 1, 8: 1, 11: 1 };
  // Якщо до цілі кілька рівноцінних проміжних кроків: якому віддати перевагу
  var PREFER = {
    4: [12, 1, 2, 5],
    3: [5],
    11: [9, 10, 13],
    10: [9],
    8: [5, 7, 2],
    15: [14, 13],
    14: [13]
  };
  // Перевага для конкретної пари «звідки, куди» (сильніша за PREFER)
  var PREFER_PAIR = { '10,1': [9] };
  // Координати виразів (валентність, збудження): серед рівноцінних кроків найближчий до цілі за змістом
  var COORD = {
    1: [-1, 0.3], 2: [-1, 0.4], 3: [-3, 1], 4: [-2, 0.6], 5: [-1.5, 0.8],
    6: [-1.5, -0.5], 7: [-2, 1], 8: [-2.5, 1], 9: [-2, -0.2], 10: [-2.5, 0],
    11: [-2.5, -0.3], 12: [-1, -1], 13: [0, 0.2], 14: [1, -0.5], 15: [2, 0]
  };

  function gap(a, b) {
    var dx = COORD[a][0] - COORD[b][0], dy = COORD[a][1] - COORD[b][1];
    return Math.pow(dx * dx + dy * dy, 0.5);
  }

  // Відстані в графі від src до всіх виразів (BFS)
  function distFrom(src) {
    var dist = {}, frontier = [src];
    dist[src] = 0;
    while (frontier.length) {
      var nxt = [];
      frontier.forEach(function (u) {
        GRAPH[u].forEach(function (v) {
          if (!(v in dist)) {
            dist[v] = dist[u] + 1;
            nxt.push(v);
          }
        });
      });
      frontier = nxt;
    }
    return dist;
  }

  var DIST = {};
  Object.keys(GRAPH).forEach(function (u) { DIST[u] = distFrom(Number(u)); });

  // Наступний вираз дорогою від cur до target: один крок графа
  function stepToward(cur, target) {
    if (cur === target) return cur;
    var cands = GRAPH[cur].filter(function (v) { return DIST[v][target] === DIST[cur][target] - 1; });
    var mild = cands.filter(function (v) { return v === target || !STRONG[v]; });
    if (mild.length) cands = mild;
    var pref = PREFER_PAIR[cur + ',' + target] || PREFER[target] || [];
    var key = function (v) {
      var i = pref.indexOf(v);
      return [i >= 0 ? i : pref.length, gap(v, target), v];
    };
    var best = null, bestKey = null;
    cands.forEach(function (v) {
      var k = key(v);
      if (best === null) { best = v; bestKey = k; return; }
      for (var i = 0; i < 3; i++) {
        if (k[i] !== bestKey[i]) {
          if (k[i] < bestKey[i]) { best = v; bestKey = k; }
          return;
        }
      }
    });
    return best;
  }

  function isAllowed(from, to) {
    return from === to || GRAPH[from].indexOf(to) >= 0;
  }

  // Ціль виразу: число або {if: умова, then: a, else: b} за станом після вибору
  function resolveExpr(spec, st) {
    if (spec !== null && typeof spec === 'object') {
      return check(spec['if'], st) ? spec.then : spec['else'];
    }
    return spec;
  }

  // Цільовий вираз репліки: авторський, з урахуванням гілки умови варіанта
  function targetExpression(st, opt, branch) {
    if (branch !== null && 'expr_then' in opt) {
      return resolveExpr(branch ? opt.expr_then : opt.expr_else, st);
    }
    return resolveExpr(opt.expr, st);
  }

  // Текст або оцінка розбору: рядок або {then, else} за гілкою умови варіанта
  function pick(spec, branch) {
    if (spec !== null && typeof spec === 'object') return branch ? spec.then : spec['else'];
    return spec;
  }

  // Вираз на вході в другу сесію: зі стану через тиждень, без пам'яті про попередній
  function sessionEntryExpression(st) {
    if (st.Z >= 7) return 12;
    if (st.Z >= 4) return st.S >= 8 ? 9 : 4;
    return st.D >= 6 ? 15 : 1;
  }

  function hasAlcohol(f) {
    return !!(f.alc_missed || f.alc_unspoken);
  }

  function suicideRisk(f) {
    if (f.risk_minimized) return 3;
    if (f.safety_plan || f.escalated) return 0;
    return 1;
  }

  // Доданки формули R. Підписи потрібні лише для екрана розбору.
  function riskTerms(st) {
    var f = st.flags;
    return [
      { key: 'Z', value: st.Z },
      { key: 'retrauma', value: 2 * (f.retrauma || 0) },
      { key: 'label', value: f.label ? 1 : 0 },
      { key: 'alcohol', value: hasAlcohol(f) ? 2 : 0 },
      { key: 'suicide', value: suicideRisk(f) },
      { key: 'benzo', value: f.benzo ? 1 : 0 },
      { key: 'avoid', value: f.avoid || 0 },
      { key: 'support', value: f.support ? -2 : 0 },
      { key: 'stab', value: f.stab ? -1 : 0 },
      { key: 'norm', value: f.norm ? -1 : 0 }
    ];
  }

  function risk(st) {
    return riskTerms(st).reduce(function (s, t) { return s + t.value; }, 0);
  }

  function hasCare(f) {
    return !!(f.followup || f.referral || f.tf_started);
  }

  function ending(st) {
    var r = risk(st);
    var f = st.flags;
    if (r >= 7 && !hasCare(f)) return 'E4';
    if (f.resent && st.D <= 2) return 'E5';
    var blocked = f.risk_minimized || hasAlcohol(f);
    if (r <= 3 && !blocked) return 'E1';
    if (r <= 6) return 'E2';
    return hasCare(f) ? 'E3' : 'E4';
  }

  function betweenSessions(st) {
    var f = st.flags;
    st.Z = clamp(st.Z - 2 + (f.retrauma || 0)
      + (hasAlcohol(f) ? 1 : 0)
      + (f.label ? 1 : 0)
      - (f.stab ? 1 : 0)
      - (f.support ? 1 : 0));
    st.S = clamp(st.S - (f.norm ? 1 : 0) + (f.label ? 1 : 0) + (f.duty_removed ? 1 : 0));
  }

  // Поділ тексту на фрагменти, по одному на клік. Фрагмент у «...» є реплікою Андрія, якщо стоїть
  // на початку тексту або одразу після . ! ? … : чи іншої репліки. Інакше лапки є цитатою
  // всередині речення і лишаються частиною розповіді. Повертає [{kind: 'speech'|'narr', text}].
  function fragments(text) {
    var out = [];
    if (!text) return out;
    var narr = '';
    var i = 0;
    function flushNarr() {
      var t = narr.trim();
      if (t) out.push({ kind: 'narr', text: t });
      narr = '';
    }
    while (i < text.length) {
      var open = text.indexOf('«', i);
      if (open < 0) { narr += text.slice(i); break; }
      var close = text.indexOf('»', open);
      if (close < 0) { narr += text.slice(i); break; }
      var before = narr + text.slice(i, open);
      var lead = before.replace(/\s+$/, '');
      var last = lead.slice(-1);
      // Порожній вступ: початок тексту або одразу після іншої репліки
      var isSpeech = lead === '' || '.!?…:'.indexOf(last) >= 0;
      if (isSpeech) {
        narr = before;
        flushNarr();
        out.push({ kind: 'speech', text: text.slice(open, close + 1) });
      } else {
        narr = before + text.slice(open, close + 1);
      }
      i = close + 1;
    }
    flushNarr();
    return out;
  }

  function createEngine(scenario) {
    var NODE = {};
    scenario.nodes.forEach(function (n) { NODE[n.id] = n; });

    // Крок обличчя на вході у вузол: розповідь (narr_face) і репліка (face)
    function enter(st, id) {
      if (id !== null && 'sit_expr' in NODE[id]) {
        st.narr_face = stepToward(st.face, NODE[id].sit_expr);
        st.face = stepToward(st.narr_face, NODE[id].sit_expr);
      } else {
        st.narr_face = st.face;
      }
    }

    function newState() {
      var st = {
        D: scenario.start.D, Z: scenario.start.Z, S: scenario.start.S,
        session: 1, flags: {}, log: [], session2: null, face: 1, narr_face: 1,
        last_target: null, last_branch: null
      };
      enter(st, 'N1');
      return st;
    }

    function cloneState(st) {
      return JSON.parse(JSON.stringify(st));
    }

    // Застосувати варіант idx (0, 1, 2) вузла. Повертає {reply, expr, branch, grade, entry}.
    // expr: вираз після вибору, тобто один крок від поточного до цілі реакції.
    function choose(st, nodeId, idx) {
      var node = NODE[nodeId];
      var opt = node.options[idx];
      var before = scales(st);
      var flagsBefore = JSON.parse(JSON.stringify(st.flags));
      var reply = opt.reply;
      apply(opt.effects, st);
      var ok = null;
      if (opt.cond) {
        ok = check(opt.cond['if'], st, before);
        apply(ok ? opt.cond.then : opt.cond['else'], st);
        var r = opt[ok ? 'reply_then' : 'reply_else'];
        if (r !== undefined) reply = r;
      }
      st.last_branch = ok;   // null, якщо умови немає, інакше true або false
      var faceBefore = st.face;
      var target = targetExpression(st, opt, ok);
      st.last_target = target;
      st.face = stepToward(st.face, target);
      var changed = [];
      Object.keys(st.flags).forEach(function (k) {
        if (st.flags[k] !== flagsBefore[k]) changed.push(k);
      });
      var entry = {
        node: nodeId, idx: idx, letter: opt.letter,
        before: before, after: scales(st), flags: changed,
        branch: ok, grade: pick(opt.analysis.grade, ok),
        expr: st.face, target: target, faceBefore: faceBefore
      };
      st.log.push(entry);
      return { reply: reply, expr: st.face, branch: ok, grade: entry.grade, entry: entry };
    }

    // Друга зустріч відбувається завжди: або за домовленістю, або командир приводить знову
    function startSession2(st) {
      st.session = 2;
      var atEnd = scales(st);
      betweenSessions(st);
      var recalc = scales(st);
      var key = st.flags.plan && !st.flags.walkout ? 'plan' : 'resent';
      apply(scenario.session2_entry[key].effects, st);
      st.D = Math.max(st.D, 1);
      st.face = sessionEntryExpression(st);   // минув тиждень: вираз зі стану, без пам'яті
      st.session2 = { key: key, atEnd: atEnd, recalc: recalc, after: scales(st), face: st.face };
      return 'N9';
    }

    // Маршрутизація після вибору у вузлі cur. null означає епілог.
    function route(st, cur) {
      var f = st.flags;
      if (st.session === 1 && st.D <= 0) {
        f.walkout = true;
        st.face = stepToward(st.face, scenario.walkout.expr);   // сцена обриву
        st.walkoutFace = st.face;
        return startSession2(st);
      }
      if (FLASH_FROM[cur] && !f.flash_done && st.Z >= 8) {
        f.flash_done = true;
        st.resume = cur;
        st.face = NODE.FLASH.entry_expr;   // інтрузія раптова: поза графом
        return 'FLASH';
      }
      var base = cur;
      if (cur === 'FLASH') {
        base = st.resume;
        delete st.resume;
      }
      if (base === 'N6' && f.screen && st.D >= 6) return 'N6B';
      if (base === 'N6B') base = 'N6';
      var i = SPINE1.indexOf(base);
      if (i >= 0) {
        if (i + 1 < SPINE1.length) return SPINE1[i + 1];
        return startSession2(st);
      }
      i = SPINE2.indexOf(base);
      return i + 1 < SPINE2.length ? SPINE2[i + 1] : null;
    }

    // Маршрутизація плюс крок обличчя до виразу ситуації нового вузла (два екрани)
    function nextNode(st, cur) {
      var nxt = route(st, cur);
      enter(st, nxt);
      return nxt;
    }

    // Один повний крок: вибір і перехід. Додатково повідомляє про обрив, початок сесії 2
    // і вирази: після вибору (expr), у сцені обриву (walkoutFace), на вході у вузол
    // на розповіді (entryNarrFace) і на репліці (entryFace).
    function step(st, nodeId, idx) {
      var wasSession = st.session;
      var hadWalkout = !!st.flags.walkout;
      var res = choose(st, nodeId, idx);
      var next = nextNode(st, nodeId);
      res.next = next;
      res.walkout = !hadWalkout && !!st.flags.walkout;
      res.walkoutFace = res.walkout ? st.walkoutFace : null;
      res.session2 = wasSession === 1 && st.session === 2 ? st.session2.key : null;
      res.session2Face = res.session2 ? st.session2.face : null;
      res.entryNarrFace = next === null ? null : st.narr_face;
      res.entryFace = next === null ? null : st.face;
      return res;
    }

    function situation(nodeId, st) {
      var node = NODE[nodeId];
      if (node.situation_by_Z) {
        for (var i = 0; i < node.situation_by_Z.length; i++) {
          var row = node.situation_by_Z[i];
          if (st.Z >= row[0] && st.Z <= row[1]) return row[2];
        }
      }
      return node.situation || null;
    }

    function optionIndex(id, letter) {
      return NODE[id].options.map(function (o) { return o.letter; }).indexOf(letter);
    }

    // Прогнати шлях вигляду ["N1В", "N2Б", ...]. Повертає кінцевий стан, фінал і вирази на кожному кроці
    // у форматі reference/golden_paths.json.
    function runPath(path) {
      var st = newState();
      var cur = 'N1';
      var faces = [];
      for (var i = 0; i < path.length; i++) {
        var p = path[i];
        var id = p.slice(0, -1), letter = p.slice(-1);
        if (id !== cur) throw new Error('Крок ' + i + ': очікувався ' + cur + ', а в шляху ' + id);
        var idx = optionIndex(id, letter);
        if (idx < 0) throw new Error('Невідомий варіант ' + p);
        var r = step(st, id, idx);
        cur = r.next;
        faces.push({
          after_choice: r.expr, walkout_scene: r.walkoutFace, next_node: r.next,
          entry_face: r.entryFace, entry_narr_face: r.entryNarrFace, grade: r.grade, branch: r.branch
        });
      }
      if (cur !== null) throw new Error('Шлях закінчився на ' + cur + ', а не в епілозі');
      return { state: st, ending: ending(st), risk: risk(st), faces: faces };
    }

    return {
      NODE: NODE,
      SPINE1: SPINE1,
      SPINE2: SPINE2,
      COUNTERS: COUNTERS,
      GRAPH: GRAPH,
      STRONG: STRONG,
      newState: newState,
      cloneState: cloneState,
      choose: choose,
      nextNode: nextNode,
      step: step,
      situation: situation,
      optionIndex: optionIndex,
      targetExpression: targetExpression,
      resolveExpr: resolveExpr,
      stepToward: stepToward,
      isAllowed: isAllowed,
      sessionEntryExpression: sessionEntryExpression,
      pick: pick,
      fragments: fragments,
      risk: risk,
      riskTerms: riskTerms,
      suicideRisk: suicideRisk,
      hasCare: hasCare,
      ending: ending,
      runPath: runPath,
      clamp: clamp
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createEngine: createEngine, fragments: fragments };
  }
  if (typeof window !== 'undefined' && window.SCENARIO) {
    window.Engine = createEngine(window.SCENARIO);
  }
})(this);

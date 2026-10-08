// Рушій новели «Третя доба». Без DOM, точно повторює reference/engine.py (версія 2: граф виразів).
// У браузері: window.Engine = createEngine(window.SCENARIO).
// У Node: require('./engine.js').createEngine(scenario).
(function (root) {
  'use strict';

  var SPINE1 = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8'];
  var SPINE2 = ['N9', 'N10', 'N11'];
  var FLASH_FROM = { N3: 1, N4: 1, N5: 1, N6: 1, N7: 1 };
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
    1: [2, 4, 6, 8, 9],
    2: [1, 3, 4, 5, 6, 8, 9],
    3: [1, 2, 6],
    4: [1, 2, 5, 6, 8, 9],
    5: [2, 4, 6, 8, 9],
    6: [1, 2, 7, 8, 9],
    7: [1, 6, 8, 9],
    8: [1, 2, 4, 6, 9],
    9: [1, 2, 6, 7, 8, 10],
    10: [1, 2, 6, 7, 9]
  };
  // Якщо до цілі кілька рівноцінних проміжних кроків: якому віддати перевагу
  var PREFER = { 7: [6, 9, 8], 3: [2, 6], 5: [2, 4], 10: [9, 7] };
  // Інтенсивність для вибору між рівноцінними проміжними кроками (менша краще)
  var INTENSITY = { 9: 1, 10: 1, 1: 2, 8: 2, 2: 3, 6: 3, 4: 4, 7: 4, 3: 5, 5: 5 };

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
    var pref = PREFER[target] || [];
    var rank = function (v) {
      var i = pref.indexOf(v);
      return [i >= 0 ? i : pref.length, INTENSITY[v], v];
    };
    var best = null;
    GRAPH[cur].forEach(function (v) {
      if (DIST[v][target] !== DIST[cur][target] - 1) return;
      if (best === null) { best = v; return; }
      var a = rank(v), b = rank(best);
      for (var i = 0; i < 3; i++) {
        if (a[i] !== b[i]) { if (a[i] < b[i]) best = v; return; }
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

  // Запасні правила виразу зі шкал (для варіанта без авторської цілі; зараз таких немає)
  function expression(st, before) {
    var D = st.D, Z = st.Z, Sh = st.S;
    var dD = D - before.D, dZ = Z - before.Z;
    if (Z >= 9 && st.session === 1) return 5;
    if (Z >= 9) return 2;
    if (dD <= -2) return 3;
    if (Sh >= 8) return 6;
    if (Z >= 7) return 2;
    if (D >= 7 && Z <= 4) return 10;
    if (dZ < 0 && D >= 5) return 9;
    if (Z <= 3 && D < 5) return 8;
    if (D >= 6 && Z <= 5) return 10;
    return 1;
  }

  // Цільовий вираз реакції: авторський, з урахуванням гілки умови варіанта
  function targetExpression(st, before, opt, branch) {
    if (branch !== null && 'expr_then' in opt) {
      return resolveExpr(branch ? opt.expr_then : opt.expr_else, st);
    }
    if ('expr' in opt) return resolveExpr(opt.expr, st);
    return expression(st, before);
  }

  // Вираз на вході в другу сесію: зі стану через тиждень, без пам'яті про попередній
  function sessionEntryExpression(st) {
    if (st.Z >= 7) return 8;
    if (st.Z >= 4) return st.S >= 8 ? 6 : 1;
    return st.D >= 6 ? 10 : 1;
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

  function createEngine(scenario) {
    var NODE = {};
    scenario.nodes.forEach(function (n) { NODE[n.id] = n; });

    function newState() {
      return {
        D: scenario.start.D, Z: scenario.start.Z, S: scenario.start.S,
        session: 1, flags: {}, log: [], session2: null, face: 1
      };
    }

    function cloneState(st) {
      return JSON.parse(JSON.stringify(st));
    }

    // Застосувати варіант idx (0, 1, 2) вузла. Повертає {reply, expr, entry}.
    // expr: вираз після вибору, тобто один крок від поточного до цілі реакції.
    function choose(st, nodeId, idx) {
      var node = NODE[nodeId];
      var opt = node.options[idx];
      var before = scales(st);
      var flagsBefore = JSON.parse(JSON.stringify(st.flags));
      var reply = opt.reply;
      var condOk = null;
      apply(opt.effects, st);
      if (opt.cond) {
        condOk = check(opt.cond['if'], st, before);
        apply(condOk ? opt.cond.then : opt.cond['else'], st);
        var r = opt[condOk ? 'reply_then' : 'reply_else'];
        if (r !== undefined) reply = r;
      }
      var faceBefore = st.face;
      var target = targetExpression(st, before, opt, condOk);
      st.face = stepToward(st.face, target);
      var expr = st.face;
      var changed = [];
      Object.keys(st.flags).forEach(function (k) {
        if (st.flags[k] !== flagsBefore[k]) changed.push(k);
      });
      var entry = {
        node: nodeId, idx: idx, letter: opt.letter,
        before: before, after: scales(st),
        flags: changed, cond: condOk, expr: expr, target: target, faceBefore: faceBefore
      };
      st.log.push(entry);
      return { reply: reply, expr: expr, entry: entry };
    }

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

    // Маршрутизація після вибору у вузлі cur плюс крок обличчя до виразу ситуації нового вузла.
    function nextNode(st, cur) {
      var nxt = route(st, cur);
      if (nxt !== null && 'sit_expr' in NODE[nxt]) st.face = stepToward(st.face, NODE[nxt].sit_expr);
      return nxt;
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

    // Один повний крок: вибір і перехід. Додатково повідомляє про обрив, початок сесії 2
    // і вирази: після вибору (expr), у сцені обриву (walkoutFace), на вході у вузол (entryFace).
    function step(st, nodeId, idx) {
      var wasSession = st.session;
      var res = choose(st, nodeId, idx);
      var next = nextNode(st, nodeId);
      res.next = next;
      res.walkout = wasSession === 1 && !!st.flags.walkout;
      res.walkoutFace = res.walkout ? st.walkoutFace : null;
      res.session2 = wasSession === 1 && st.session === 2 ? st.session2.key : null;
      res.session2Face = res.session2 ? st.session2.face : null;
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
      return node.situation;
    }

    // Прогнати шлях вигляду ["N1В", "N2Б", ...]. Повертає кінцевий стан, фінал і вирази на кожному кроці.
    function runPath(path) {
      var st = newState();
      var cur = 'N1';
      var faces = [];
      for (var i = 0; i < path.length; i++) {
        var p = path[i];
        var id = p.slice(0, -1), letter = p.slice(-1);
        if (id !== cur) throw new Error('Крок ' + i + ': очікувався ' + cur + ', а в шляху ' + id);
        var idx = NODE[id].options.map(function (o) { return o.letter; }).indexOf(letter);
        if (idx < 0) throw new Error('Невідомий варіант ' + p);
        var r = step(st, id, idx);
        cur = r.next;
        faces.push({ after_choice: r.expr, walkout_scene: r.walkoutFace, next_node: r.next, entry_face: r.entryFace });
      }
      if (cur !== null) throw new Error('Шлях закінчився на ' + cur + ', а не в епілозі');
      return { state: st, ending: ending(st), risk: risk(st), faces: faces };
    }

    return {
      NODE: NODE,
      SPINE1: SPINE1,
      SPINE2: SPINE2,
      COUNTERS: COUNTERS,
      newState: newState,
      cloneState: cloneState,
      choose: choose,
      nextNode: nextNode,
      step: step,
      situation: situation,
      expression: expression,
      targetExpression: targetExpression,
      resolveExpr: resolveExpr,
      stepToward: stepToward,
      isAllowed: isAllowed,
      sessionEntryExpression: sessionEntryExpression,
      GRAPH: GRAPH,
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
    module.exports = { createEngine: createEngine };
  }
  if (typeof window !== 'undefined' && window.SCENARIO) {
    window.Engine = createEngine(window.SCENARIO);
  }
})(this);

// Рушій новели «Третя доба». Без DOM, точно повторює reference/engine.py.
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

  function check(cond, st, before) {
    if (cond.indexOf('flag:') === 0) {
      return !!st.flags[cond.slice(5)];
    }
    var m = /^([DZS])(>=|<=)(\d+)$/.exec(cond);
    if (!m) throw new Error('Невідома умова: ' + cond);
    var v = before[m[1]];
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

  function expression(st, before, opt) {
    if (opt && 'expr' in opt) return opt.expr;
    var D = st.D, Z = st.Z, Sh = st.S;
    var dD = D - before.D, dZ = Z - before.Z;
    if (Z >= 9) return 5;
    if (dD <= -2) return 3;
    if (Sh >= 8) return 6;
    if (Z >= 7) return 2;
    if (D >= 7 && Z <= 4) return 10;
    if (dZ < 0 && D >= 5) return 9;
    if (Z <= 3 && D < 5) return 8;
    if (D >= 5) return 7;
    return 1;
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
        session: 1, flags: {}, log: [], session2: null
      };
    }

    function cloneState(st) {
      return JSON.parse(JSON.stringify(st));
    }

    // Застосувати варіант idx (0, 1, 2) вузла. Повертає {reply, expr, entry}.
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
      var expr = expression(st, before, opt);
      var changed = [];
      Object.keys(st.flags).forEach(function (k) {
        if (st.flags[k] !== flagsBefore[k]) changed.push(k);
      });
      var entry = {
        node: nodeId, idx: idx, letter: opt.letter,
        before: before, after: scales(st),
        flags: changed, cond: condOk, expr: expr
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
      st.session2 = { key: key, atEnd: atEnd, recalc: recalc, after: scales(st) };
      return 'N9';
    }

    // Маршрутизація після вибору у вузлі cur. null означає епілог.
    function nextNode(st, cur) {
      var f = st.flags;
      if (st.session === 1 && st.D <= 0) {
        f.walkout = true;
        return startSession2(st);
      }
      if (FLASH_FROM[cur] && !f.flash_done && st.Z >= 8) {
        f.flash_done = true;
        st.resume = cur;
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

    // Один повний крок: вибір і перехід. Додатково повідомляє про обрив і початок сесії 2.
    function step(st, nodeId, idx) {
      var wasSession = st.session;
      var res = choose(st, nodeId, idx);
      var next = nextNode(st, nodeId);
      res.next = next;
      res.walkout = wasSession === 1 && !!st.flags.walkout;
      res.session2 = wasSession === 1 && st.session === 2 ? st.session2.key : null;
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

    // Прогнати шлях вигляду ["N1В", "N2Б", ...]. Повертає кінцевий стан і фінал.
    function runPath(path) {
      var st = newState();
      var cur = 'N1';
      for (var i = 0; i < path.length; i++) {
        var p = path[i];
        var id = p.slice(0, -1), letter = p.slice(-1);
        if (id !== cur) throw new Error('Крок ' + i + ': очікувався ' + cur + ', а в шляху ' + id);
        var idx = NODE[id].options.map(function (o) { return o.letter; }).indexOf(letter);
        if (idx < 0) throw new Error('Невідомий варіант ' + p);
        cur = step(st, id, idx).next;
      }
      if (cur !== null) throw new Error('Шлях закінчився на ' + cur + ', а не в епілозі');
      return { state: st, ending: ending(st), risk: risk(st) };
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

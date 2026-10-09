# -*- coding: utf-8 -*-
"""Еталонна реалізація алгоритму. Читає scenario.json з тієї ж папки або з ../data/.
JS-рушій у репозиторії має давати ті самі результати (див. golden_paths.json)."""
import copy, json, os, re
from types import SimpleNamespace

_HERE = os.path.dirname(os.path.abspath(__file__))
_PATH = next(p for p in (os.path.join(_HERE, "scenario.json"),
                         os.path.join(_HERE, "..", "data", "scenario.json")) if os.path.exists(p))
_D = json.load(open(_PATH, encoding="utf-8"))
S = SimpleNamespace(START=_D["start"], NODES=_D["nodes"], WALKOUT=_D["walkout"],
                    SESSION2_ENTRY=_D["session2_entry"], ENDINGS=_D["endings"],
                    INTRO=_D["intro"], EXPRESSIONS=_D["expressions"])

NODE = {n["id"]: n for n in S.NODES}
SPINE1 = ["N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8"]
SPINE2 = ["N9", "N10", "N11"]
FLASH_FROM = {"N3", "N4", "N5", "N6", "N7"}   # після цих вузлів можливий флешбек
COUNTERS = {"retrauma", "avoid"}


def clamp(v):
    return max(0, min(10, v))


def check(cond, st):
    if cond.startswith("flag:"):
        return bool(st["flags"].get(cond[5:]))
    m = re.fullmatch(r"([DZS])(>=|<=)(\d+)", cond)
    var, op, val = m.group(1), m.group(2), int(m.group(3))
    return st[var] >= val if op == ">=" else st[var] <= val


def apply(eff, st):
    for k in ("D", "Z", "S"):
        if k in eff:
            st[k] = clamp(st[k] + eff[k])
    for f in eff.get("set", []):
        st["flags"][f] = True
    for f in eff.get("inc", []):
        st["flags"][f] = st["flags"].get(f, 0) + 1


# Граф дозволених переходів виразів за один екран (залишитися в тому самому можна завжди)
GRAPH = {
    1: {2, 4, 5, 9, 10, 12, 13, 14, 15},              # закритий
    2: {1, 4, 5, 7, 9, 13},                   # скептичний
    3: {1, 4, 5, 10},                         # гнів, агресія: лише після 5
    4: {1, 2, 5, 9, 10, 12, 13, 14},          # стримана фрустрація, втомлено-похмурий
    5: {1, 2, 3, 4, 7, 8, 9, 12, 13, 14},         # напруження, роздратування, настороженість
    6: {5, 8, 9, 12, 13},                     # відсутній погляд
    7: {2, 5, 6, 8, 13},                      # гіпернастороженість
    8: {1, 2, 5, 6, 7, 9, 13, 14},               # тривога, придушена паніка
    9: {1, 2, 4, 5, 10, 11, 12, 13},          # сором, погляд униз
    10: {4, 9, 11, 12, 13},                   # провина
    11: {4, 5, 9, 10, 12, 13, 14},               # сум, стримані сльози
    12: {1, 4, 5, 6, 9, 13},                  # глибока втома
    13: {1, 2, 9, 10, 11, 14, 15},              # осмислення
    14: {1, 2, 5, 11, 12, 13, 15},            # полегшення
    15: {1, 2, 5, 9, 11, 13, 14},             # обережна довіра
}
# сильні вирази (гнів, дисоціація, паніка, сльози) не бувають проміжним кроком
STRONG = {3, 6, 8, 11}
# Якщо до цілі кілька рівноцінних проміжних кроків: якому віддати перевагу
PREFER = {
    4: [12, 1, 2, 5],   # до втомлено-похмурого: через втому або закритість
    3: [5],             # до гніву: лише через напруження і роздратування
    11: [9, 10, 13],    # до сліз: через погляд униз або провину
    10: [9],            # до провини: через сором
    8: [5, 7, 2],       # до тривоги: через напруження або настороженість
    15: [14, 13],       # до довіри: через полегшення
    14: [13],           # до полегшення: через осмислення
}
# Перевага для конкретної пари «звідки, куди» (сильніша за PREFER)
PREFER_PAIR = {
    (10, 1): [9],       # від провини до закритості: через сором, погляд униз
}
# Координати виразів (валентність, збудження): серед рівноцінних проміжних кроків
# обирається найближчий до цілі за змістом
COORD = {1: (-1, 0.3), 2: (-1, 0.4), 3: (-3, 1), 4: (-2, 0.6), 5: (-1.5, 0.8),
         6: (-1.5, -0.5), 7: (-2, 1), 8: (-2.5, 1), 9: (-2, -0.2), 10: (-2.5, 0),
         11: (-2.5, -0.3), 12: (-1, -1), 13: (0, 0.2), 14: (1, -0.5), 15: (2, 0)}


def _gap(a, b):
    return ((COORD[a][0] - COORD[b][0]) ** 2 + (COORD[a][1] - COORD[b][1]) ** 2) ** 0.5


def _dist_from(src):
    """Відстані в графі від src до всіх вузлів (BFS)."""
    dist, frontier = {src: 0}, [src]
    while frontier:
        nxt = []
        for u in frontier:
            for v in GRAPH[u]:
                if v not in dist:
                    dist[v] = dist[u] + 1
                    nxt.append(v)
        frontier = nxt
    return dist


DIST = {u: _dist_from(u) for u in GRAPH}


def step_toward(cur, target):
    """Наступний вираз дорогою від cur до target: один крок графа."""
    if cur == target:
        return cur
    cands = [v for v in GRAPH[cur] if DIST[v][target] == DIST[cur][target] - 1]
    # сильні вирази (гнів, дисоціація, паніка, сльози) не бувають проміжним кроком
    mild = [v for v in cands if v == target or v not in STRONG]
    cands = mild or cands
    pref = PREFER_PAIR.get((cur, target)) or PREFER.get(target, [])
    return min(cands, key=lambda v: (pref.index(v) if v in pref else len(pref), _gap(v, target), v))


def resolve_expr(spec, st):
    """Ціль виразу: число або {"if": умова, "then": a, "else": b} за станом після вибору."""
    if isinstance(spec, dict):
        return spec["then"] if check(spec["if"], st) else spec["else"]
    return spec


def target_expression(st, before, opt, branch=None):
    """Цільовий вираз репліки: авторський, з урахуванням гілки умови варіанта."""
    if branch is not None and "expr_then" in opt:
        return resolve_expr(opt["expr_then"] if branch else opt["expr_else"], st)
    return resolve_expr(opt["expr"], st)   # кожен варіант має авторську ціль


def session_entry_expression(st):
    """Вираз на вході в другу сесію: зі стану через тиждень, без пам'яті про попередній."""
    if st["Z"] >= 7: return 12         # «Стало тільки гірше.» глибока втома
    if st["Z"] >= 4: return 9 if st["S"] >= 8 else 4
    return 15 if st["D"] >= 6 else 1


def choose(st, node_id, idx):
    """Застосувати варіант idx (0,1,2) вузла. Повертає (reply, expr)."""
    node = NODE[node_id]
    opt = node["options"][idx]
    before = {k: st[k] for k in "DZS"}
    reply = opt.get("reply")
    apply(opt.get("effects", {}), st)
    ok = None
    if "cond" in opt:
        ok = check(opt["cond"]["if"], {**st, **before, "flags": st["flags"]})
        apply(opt["cond"]["then"] if ok else opt["cond"]["else"], st)
        reply = opt.get("reply_then" if ok else "reply_else", reply)
    st["log"].append((node_id, opt["letter"], dict(before), {k: st[k] for k in "DZS"}))
    st["last_branch"] = ok      # None, якщо умови немає, інакше True або False
    target = target_expression(st, before, opt, ok)
    st["last_target"] = target
    st["face"] = step_toward(st["face"], target)
    return reply, st["face"]


def pick(spec, branch):
    """Текст або оцінка розбору: рядок або {"then": .., "else": ..} за гілкою умови варіанта."""
    if isinstance(spec, dict):
        return spec["then"] if branch else spec["else"]
    return spec


def between_sessions(st):
    f = st["flags"]
    st["Z"] = clamp(st["Z"] - 2 + f.get("retrauma", 0)
                    + (1 if f.get("alc_missed") or f.get("alc_unspoken") else 0)
                    + (1 if f.get("label") else 0)
                    - (1 if f.get("stab") else 0)
                    - (1 if f.get("support") else 0))
    st["S"] = clamp(st["S"] - (1 if f.get("norm") else 0) + (1 if f.get("label") else 0)
                    + (1 if f.get("duty_removed") else 0))


def risk(st):
    f = st["flags"]
    if f.get("risk_minimized"):
        suicide_risk = 3          # клієнт сказав, психолог знецінив
    elif f.get("safety_plan") or f.get("escalated"):
        suicide_risk = 0
    else:
        suicide_risk = 1          # не спитали або спитали без довіри (заперечив)
    return (st["Z"] + 2 * f.get("retrauma", 0) + (1 if f.get("label") else 0)
            + (2 if f.get("alc_missed") or f.get("alc_unspoken") else 0)
            + suicide_risk
            + (1 if f.get("benzo") else 0) + f.get("avoid", 0)
            - (2 if f.get("support") else 0) - (1 if f.get("stab") else 0)
            - (1 if f.get("norm") else 0))


def start_session2(st):
    """Друга зустріч відбувається завжди: або за домовленістю, або командир приводить знову."""
    st["session"] = 2
    between_sessions(st)
    f = st["flags"]
    key = "plan" if f.get("plan") and not f.get("walkout") else "resent"
    apply(S.SESSION2_ENTRY[key]["effects"], st)
    st["D"] = max(st["D"], 1)
    st["face"] = session_entry_expression(st)   # минув тиждень: вираз зі стану, без пам'яті
    return "N9"


def ending(st):
    r = risk(st)
    f = st["flags"]
    care = f.get("followup") or f.get("referral") or f.get("tf_started")
    if r >= 7 and not care:
        return "E4"
    if f.get("resent") and st["D"] <= 2:
        return "E5"
    care = f.get("followup") or f.get("referral") or f.get("tf_started")
    blocked = f.get("risk_minimized") or f.get("alc_missed") or f.get("alc_unspoken")
    if r <= 3 and not blocked: return "E1"
    if r <= 6: return "E2"
    return "E3" if care else "E4"


def new_state():
    return {**copy.deepcopy(S.START), "flags": {}, "log": [], "path": [], "face": 1}


def next_node(st, cur):
    """Маршрутизація після вибору у вузлі cur плюс крок обличчя до виразу ситуації нового вузла."""
    nxt = _route(st, cur)
    if nxt is not None and "sit_expr" in NODE[nxt]:
        # два екрани ситуації: розповідь (крок 1) і репліка Андрія (крок 2)
        st["narr_face"] = step_toward(st["face"], NODE[nxt]["sit_expr"])
        st["face"] = step_toward(st["narr_face"], NODE[nxt]["sit_expr"])
    else:
        st["narr_face"] = st["face"]
    return nxt


def _route(st, cur):
    """Маршрутизація після вибору у вузлі cur. None = епілог."""
    f = st["flags"]
    if st["session"] == 1 and st["D"] <= 0:
        f["walkout"] = True
        st["face"] = step_toward(st["face"], S.WALKOUT["expr"])   # сцена обриву
        st["walkout_face"] = st["face"]
        return start_session2(st)
    if cur in FLASH_FROM and not f.get("flash_done") and st["Z"] >= 8:
        f["flash_done"] = True
        st["resume"] = cur
        st["face"] = NODE["FLASH"]["entry_expr"]   # інтрузія раптова: поза графом
        return "FLASH"
    base = st.pop("resume", None) if cur == "FLASH" else cur
    if base == "N6" and f.get("screen") and st["D"] >= 6:
        return "N6B"
    if base == "N6B":
        base = "N6"
    if base in SPINE1:
        i = SPINE1.index(base)
        if i + 1 < len(SPINE1):
            return SPINE1[i + 1]
        return start_session2(st)
    i = SPINE2.index(base)
    return SPINE2[i + 1] if i + 1 < len(SPINE2) else None

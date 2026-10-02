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


def expression(st, before, opt, node):
    """Правила виразу обличчя, за пріоритетом."""
    if opt is not None and "expr" in opt:
        return opt["expr"]
    D, Z, Sh = st["D"], st["Z"], st["S"]
    dD, dZ = D - before["D"], Z - before["Z"]
    if Z >= 9: return 5
    if dD <= -2: return 3
    if Sh >= 8: return 6
    if Z >= 7: return 2
    if D >= 7 and Z <= 4: return 10
    if dZ < 0 and D >= 5: return 9
    if Z <= 3 and D < 5: return 8
    if D >= 5: return 7
    return 1


def choose(st, node_id, idx):
    """Застосувати варіант idx (0,1,2) вузла. Повертає (reply, expr)."""
    node = NODE[node_id]
    opt = node["options"][idx]
    before = {k: st[k] for k in "DZS"}
    reply = opt.get("reply")
    apply(opt.get("effects", {}), st)
    if "cond" in opt:
        ok = check(opt["cond"]["if"], {**st, **before, "flags": st["flags"]})
        apply(opt["cond"]["then"] if ok else opt["cond"]["else"], st)
        reply = opt.get("reply_then" if ok else "reply_else", reply)
    st["log"].append((node_id, opt["letter"], dict(before), {k: st[k] for k in "DZS"}))
    return reply, expression(st, before, opt, node)


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
    return {**copy.deepcopy(S.START), "flags": {}, "log": [], "path": []}


def next_node(st, cur):
    """Маршрутизація після вибору у вузлі cur. None = епілог."""
    f = st["flags"]
    if st["session"] == 1 and st["D"] <= 0:
        f["walkout"] = True
        return start_session2(st)
    if cur in FLASH_FROM and not f.get("flash_done") and st["Z"] >= 8:
        f["flash_done"] = True
        st["resume"] = cur
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

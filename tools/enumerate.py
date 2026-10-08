# -*- coding: utf-8 -*-
"""Повний перебір усіх шляхів еталонним рушієм reference/engine.py.
Друкує по рядку на шлях у тому самому порядку, що й tools/test-engine.js:
шлях|фінал|D,Z,S|R|вирази кроків (після вибору/обрив/вхід у наступний вузол)."""
import copy, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "reference"))
sys.dont_write_bytecode = True
import engine as E  # noqa: E402

out = sys.stdout


def fmt(v):
    return "-" if v is None else str(v)


def walk(st, cur, trail, faces):
    if cur is None:
        out.write("%s|%s|%d,%d,%d|%d|%s\n" % (" ".join(trail), E.ending(st), st["D"], st["Z"], st["S"],
                                            E.risk(st), " ".join(faces)))
        return
    node = E.NODE[cur]
    for i, opt in enumerate(node["options"]):
        s2 = copy.deepcopy(st)
        s2.pop("walkout_face", None)
        _, after = E.choose(s2, cur, i)
        nxt = E.next_node(s2, cur)
        entry = s2["face"] if nxt is not None else None
        walk(s2, nxt, trail + [cur + opt["letter"]],
             faces + ["%d/%s/%s" % (after, fmt(s2.get("walkout_face")), fmt(entry))])


st = E.new_state()
st["session"] = 1
walk(st, "N1", [], [])

# -*- coding: utf-8 -*-
"""Повний перебір усіх шляхів. Один рядок на шлях:
шлях<TAB>фінал<TAB>D,Z,S<TAB>R<TAB>послідовність облич.
Послідовність облич: для кожного вибору after_choice, потім (якщо є сцена обриву) W<обличчя>,
потім на вході в наступний вузол narr_face/face. Порядок шляхів: А, Б, В у кожній розвилці."""
import copy, sys, engine as E

def dfs(st, node, path, faces, out):
    for i in range(3):
        s = copy.deepcopy(st)
        _, f = E.choose(s, node, i)
        p = path + [node + E.NODE[node]["options"][i]["letter"]]
        fc = faces + [str(f)]
        nx = E.next_node(s, node)
        if "walkout_face" in s and not s.get("_w"):
            s["_w"] = 1; fc.append("W" + str(s["walkout_face"]))
        if nx is None:
            out.write("\t".join([" ".join(p), E.ending(s), f"{s['D']},{s['Z']},{s['S']}", str(E.risk(s)), " ".join(fc)]) + "\n")
        else:
            fc.append(f"{s['narr_face']}/{s['face']}")
            dfs(s, nx, p, fc, out)

if __name__ == "__main__":
    st = E.new_state(); st["session"] = 1
    t = E.NODE["N1"]["sit_expr"]
    st["narr_face"] = E.step_toward(st["face"], t); st["face"] = E.step_toward(st["narr_face"], t)
    dfs(st, "N1", [], [f"{st['narr_face']}/{st['face']}"], sys.stdout)

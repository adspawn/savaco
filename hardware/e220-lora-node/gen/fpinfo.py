"""Footprint geometry helpers (parsed from .kicad_mod files, no pcbnew needed)."""
import os
from sexp import parse, find, findall

HERE = os.path.dirname(os.path.abspath(__file__))


def fp_path(fpid):
    lib, name = fpid.split(":")
    d = os.path.join(HERE, "..", "lib", "e220_lora.pretty") if lib == "e220_lora" \
        else f"/usr/share/kicad/footprints/{lib}.pretty"
    return os.path.abspath(d), name


def courtyard(fpid):
    d, name = fp_path(fpid)
    t = parse(open(os.path.join(d, name + ".kicad_mod")).read())
    xs, ys = [], []
    for e in t:
        if isinstance(e, list) and e and e[0] in ("fp_line", "fp_rect", "fp_poly", "fp_circle", "fp_arc"):
            ly = find(e, "layer")
            if not ly or ly[1] != "F.CrtYd":
                continue
            if e[0] == "fp_circle":
                c, en = find(e, "center"), find(e, "end")
                r = ((float(c[1]) - float(en[1])) ** 2 + (float(c[2]) - float(en[2])) ** 2) ** .5
                xs += [float(c[1]) - r, float(c[1]) + r]; ys += [float(c[2]) - r, float(c[2]) + r]
                continue
            for k in ("start", "end", "mid"):
                v = find(e, k)
                if v:
                    xs.append(float(v[1])); ys.append(float(v[2]))
            pts = find(e, "pts")
            if pts:
                for xy in findall(pts, "xy"):
                    xs.append(float(xy[1])); ys.append(float(xy[2]))
    return (min(xs), min(ys), max(xs), max(ys))

"""Courtyard overlap / board-edge check for placement.py."""
import math, sys
import design, fpinfo, placement as pl

SPECIAL = {"U4": [(-9.75, -6.85, 9.75, 7.15), (-14.25, -13.1, 14.25, -6.85)]}  # body + on-board antenna keepout

def world_box(ref, local=None):
    p = next(q for q in design.parts if q["ref"] == ref)
    x0, y0, x1, y1 = local or fpinfo.courtyard(p["fp"])
    X, Y, r = pl.P[ref]
    pts = []
    for (x, y) in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
        a = math.radians(r)
        # KiCad: positive rotation = CCW on screen (y down)
        xr = x * math.cos(a) + y * math.sin(a)
        yr = -x * math.sin(a) + y * math.cos(a)
        pts.append((X + xr, Y + yr))
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))

def main():
    refs = [p["ref"] for p in design.parts]
    missing = [r for r in refs if r not in pl.P]
    if missing: print("UNPLACED", missing)
    boxes = {}
    for r in refs:
        if r not in pl.P: continue
        if r in SPECIAL:
            for k, loc in enumerate(SPECIAL[r]):
                boxes[f"{r}#{k}"] = world_box(r, loc)
        else:
            boxes[r] = world_box(r)
    bad = 0
    allow = {("U4", "H1")}
    for i, a in enumerate(boxes):
        A = boxes[a]
        if A[0] < -0.5 or A[1] < -6 or A[2] > pl.BOARD_W + 0.5 or A[3] > pl.BOARD_H + 0.5:
            if a.split("#")[0] not in ("U4", "J1", "SW1", "J2"):
                print(f"EDGE {a} {tuple(round(v,2) for v in A)}"); bad += 1
        for b in list(boxes)[i+1:]:
            B = boxes[b]
            ox = min(A[2], B[2]) - max(A[0], B[0]); oy = min(A[3], B[3]) - max(A[1], B[1])
            if ox > 0.05 and oy > 0.05:
                if (a, b) in allow or (b, a) in allow: continue
                print(f"OVERLAP {a:5s} {b:5s} {ox:.2f} x {oy:.2f}"); bad += 1
    print("issues:", bad)
    return bad

if __name__ == "__main__":
    sys.exit(1 if main() else 0)

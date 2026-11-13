"""Small 2-layer grid autorouter for this board (numpy + A*).

- 0.1 mm grid, 8-direction moves, vias between F.Cu/B.Cu
- obstacles = copper of other nets dilated by (half width + clearance)
- signal nets are routed as Steiner-ish trees (each pad joins the tree)
- GND is not routed: every GND SMD pad gets a short fan-out to a via, and the
  GND pours on both layers (added in make_pcb.py finish) tie everything up
Result is checked afterwards with KiCad's own DRC (pcbnew.WriteDRCReport).
"""
import heapq
import math
import sys

import numpy as np
import pcbnew

import placement as pl
from make_pcb import OX, OY, PCB

G = 0.1                      # grid pitch (mm)
RASTER = 0.071               # every cell whose centre is within this of copper is marked, so any
                             # copper point is within RASTER of a marked cell centre
CLR = 0.15 + RASTER + 0.01   # => real copper-to-copper clearance >= 0.15 mm (KiCad board rule)
VIA_D, VIA_DRILL = 0.6, 0.3
W = int(round(pl.BOARD_W / G))
H = int(round(pl.BOARD_H / G))

WIDTH = {"ANT": 0.6, "VBUS": 0.5, "VSYS": 0.5, "VBAT": 0.5, "VSW": 0.5, "+3V3": 0.4, "V12": 0.5,
         "MT_SW": 0.6, "BUZ_N": 0.4, "SIREN_N": 0.4, "GND": 0.4}
DEFAULT_W = 0.25
ORDER_FIRST = ["ANT", "USB_DP", "USB_DN", "MT_SW", "V12", "MT_FB", "VBUS", "VSYS", "VBAT", "VSW", "+3V3",
               "CC1", "CC2"]

mm = pcbnew.FromMM
toMM = pcbnew.ToMM


def cell_center(i, j):
    return (OX + (i + 0.5) * G, OY + (j + 0.5) * G)


def disk(r):
    R = int(math.ceil(r))
    return [(dx, dy) for dx in range(-R, R + 1) for dy in range(-R, R + 1) if dx * dx + dy * dy < r * r - 1e-6]


def dilate(mask, r):
    """Binary dilation of a 2-D bool array by a disk of radius r cells."""
    R = int(math.ceil(r))
    if R <= 0:
        return mask.copy()
    p = np.pad(mask, R)
    out = np.zeros_like(mask)
    for dx, dy in disk(r):
        out |= p[R + dy:R + dy + mask.shape[0], R + dx:R + dx + mask.shape[1]]
    return out


class Router:
    def __init__(self, board, base=None):
        self.board = board
        self.tracks = []                                     # (net, layer, (x1,y1), (x2,y2), width)
        self.vias = []                                       # (net, (x, y))
        self.failed = []
        self.fanned = set(base.fanned) if base is not None else set()
        if base is not None:                                 # reuse the static raster
            self.nets = dict(base.nets)
            self.owner = base.owner.copy()
            self.padmask = base.padmask
            self.viamask = base.viamask.copy()
            self.pads = base.pads
            self.tracks = list(base.tracks)
            self.vias = list(base.vias)
            return
        self.nets = {}
        self.owner = np.zeros((2, H, W), dtype=np.int16)    # 0 free, -1 everyone-obstacle, >0 net id
        self.padmask = np.zeros((H, W), dtype=bool)          # any pad copper (no vias in pads)
        self.viamask = np.zeros((H, W), dtype=bool)          # via centres (hole-to-hole spacing)
        self.pads = {}                                       # net -> list of pad dicts
        self._raster_static()

    # ------------------------------------------------------------ rasterize --
    def nid(self, name):
        if name not in self.nets:
            self.nets[name] = len(self.nets) + 1
        return self.nets[name]

    def _cells_in_bbox(self, bb, margin=0.0):
        i0 = max(0, int((toMM(bb.GetLeft()) - OX - margin) / G))
        i1 = min(W - 1, int((toMM(bb.GetRight()) - OX + margin) / G) + 1)
        j0 = max(0, int((toMM(bb.GetTop()) - OY - margin) / G))
        j1 = min(H - 1, int((toMM(bb.GetBottom()) - OY + margin) / G) + 1)
        return i0, i1, j0, j1

    def _raster_static(self):
        b = self.board
        # board edge band
        e = int(round(0.3 / G))
        for l in (0, 1):
            self.owner[l, :e, :] = -1; self.owner[l, -e:, :] = -1
            self.owner[l, :, :e] = -1; self.owner[l, :, -e:] = -1
        # rounded corners
        r = pl.CORNER_R
        for (cx, cy) in ((r, r), (pl.BOARD_W - r, r), (r, pl.BOARD_H - r), (pl.BOARD_W - r, pl.BOARD_H - r)):
            for j in range(H):
                for i in range(W):
                    x, y = (i + 0.5) * G, (j + 0.5) * G
                    if (abs(x - cx) <= r and abs(y - cy) <= r and
                            ((x < r or x > pl.BOARD_W - r) and (y < r or y > pl.BOARD_H - r)) and
                            math.hypot(x - cx, y - cy) > r - 0.3):
                        self.owner[:, j, i] = -1
        for fp in b.GetFootprints():
            for pad in fp.Pads():
                net = pad.GetNetname()
                layers = [l for l, L in ((0, pcbnew.F_Cu), (1, pcbnew.B_Cu)) if pad.IsOnLayer(L)]
                npth = pad.GetAttribute() == pcbnew.PAD_ATTRIB_NPTH
                if npth:
                    layers = [0, 1]
                val = self.nid(net) if net else -1
                i0, i1, j0, j1 = self._cells_in_bbox(pad.GetBoundingBox())
                cells = []
                for j in range(j0, j1 + 1):
                    for i in range(i0, i1 + 1):
                        x, y = cell_center(i, j)
                        if pad.HitTest(pcbnew.VECTOR2I(mm(x), mm(y)), mm(RASTER)):
                            cells.append((i, j))
                if not cells:   # tiny pad: take the centre cell
                    p = pad.GetPosition()
                    cells = [(int((toMM(p.x) - OX) / G), int((toMM(p.y) - OY) / G))]
                for (i, j) in cells:
                    for l in layers:
                        if npth or val == -1:
                            self.owner[l, j, i] = -1
                        else:
                            self.owner[l, j, i] = val
                    self.padmask[j, i] = True
                if net and not npth:
                    p = pad.GetPosition()
                    self.pads.setdefault(net, []).append(dict(
                        ref=fp.GetReference(), num=pad.GetNumber(), layers=layers, cells=cells,
                        center=(toMM(p.x), toMM(p.y)), smd=len(layers) == 1))
            # keep-out rule areas inside footprints (ESP32 antenna)
            for z in fp.Zones():
                if not z.GetIsRuleArea():
                    continue
                i0, i1, j0, j1 = self._cells_in_bbox(z.GetBoundingBox())
                for j in range(j0, j1 + 1):
                    for i in range(i0, i1 + 1):
                        x, y = cell_center(i, j)
                        if z.Outline().Contains(pcbnew.VECTOR2I(mm(x), mm(y))):
                            self.owner[:, j, i] = -1
        # mounting holes: keep copper away from screw heads (r = 3.2 mm)
        for fp in b.GetFootprints():
            if fp.GetReference().startswith("H"):
                p = fp.GetPosition()
                ci, cj = (toMM(p.x) - OX) / G, (toMM(p.y) - OY) / G
                for dx, dy in disk(3.3 / G):
                    i, j = int(ci + dx), int(cj + dy)
                    if 0 <= i < W and 0 <= j < H:
                        self.owner[:, j, i] = -1

    def _paint_segment(self, k, l, a, b, hw):
        (x1, y1), (x2, y2) = a, b
        r = hw + RASTER
        i0 = max(0, int((min(x1, x2) - OX - r) / G) - 1); i1 = min(W - 1, int((max(x1, x2) - OX + r) / G) + 1)
        j0 = max(0, int((min(y1, y2) - OY - r) / G) - 1); j1 = min(H - 1, int((max(y1, y2) - OY + r) / G) + 1)
        ii, jj = np.meshgrid(np.arange(i0, i1 + 1), np.arange(j0, j1 + 1))
        px = OX + (ii + 0.5) * G; py = OY + (jj + 0.5) * G
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy
        t = np.clip(((px - x1) * dx + (py - y1) * dy) / L2, 0, 1) if L2 > 0 else 0
        d = np.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
        m = d <= r
        sub = self.owner[l, j0:j1 + 1, i0:i1 + 1]
        sub[m & (sub == 0)] = k
        inner = d <= max(hw - 0.06, 0.02)      # cells safely inside the copper (tree targets)
        return (jj[inner], ii[inner])

    # ---------------------------------------------------------------- A* ----
    def _blocked(self, k, hw):
        rad = (hw + CLR) / G
        blk = np.zeros((2, H, W), dtype=bool)
        for l in (0, 1):
            other = (self.owner[l] != 0) & (self.owner[l] != k)
            blk[l] = dilate(other, rad)
        vr = (VIA_D / 2 + CLR) / G
        vblk = dilate((self.owner[0] != 0) & (self.owner[0] != k), vr) | \
            dilate((self.owner[1] != 0) & (self.owner[1] != k), vr) | dilate(self.padmask, VIA_D / 2 / G + 1) | \
            dilate(self.viamask, (VIA_D + 0.25) / G)
        return blk, vblk

    def astar(self, starts, goal, blk, vblk, bcost=1.6, via_cost=60, goal_is_via=False):
        """starts: list of (l, j, i); goal: bool array (2,H,W) or None."""
        N = H * W
        blkf = blk.reshape(-1)
        vblkf = vblk.reshape(-1)
        goalf = goal.reshape(-1) if goal is not None else None
        gx = gy = None
        if goal is not None:
            ls, js, is_ = np.nonzero(goal)
            # heuristic target = closest goal cell to the start (cheap, slightly inadmissible)
            sj, si = starts[0][1], starts[0][2]
            d = (js - sj) ** 2 + (is_ - si) ** 2
            idx = int(np.argmin(d))
            gx, gy = int(is_[idx]), int(js[idx])
        dist = {}
        prev = {}
        heap = []
        for (l, j, i) in starts:
            n = l * N + j * W + i
            dist[n] = 0
            prev[n] = -1
            heapq.heappush(heap, (0, 0, n))
        dirs = [(1, 0, 10), (-1, 0, 10), (0, 1, 10), (0, -1, 10), (1, 1, 14), (1, -1, 14), (-1, 1, 14), (-1, -1, 14)]
        expanded = 0
        while heap:
            f, g, n = heapq.heappop(heap)
            if dist.get(n, 1 << 60) < g:
                continue
            l, rem = divmod(n, N)
            j, i = divmod(rem, W)
            if goal_is_via:
                if l == 1 or (g > 0 and not vblkf[rem]):
                    # finishing on B.Cu via a via at this cell
                    if l == 0:
                        return self._path(prev, n, N) + [(1, j, i)]
                    return self._path(prev, n, N)
            elif goalf[n] and g > 0 or (goalf[n] and prev[n] == -1):
                return self._path(prev, n, N)
            expanded += 1
            if expanded > 600000:
                return None
            mult = 10 if l == 0 else int(10 * bcost)
            for dx, dy, c in dirs:
                ii, jj = i + dx, j + dy
                if ii < 0 or jj < 0 or ii >= W or jj >= H:
                    continue
                m = l * N + jj * W + ii
                if blkf[m] and not (goalf is not None and goalf[m]):
                    continue
                if dx and dy:   # no corner cutting
                    if blkf[l * N + j * W + ii] or blkf[l * N + jj * W + i]:
                        continue
                ng = g + c * mult // 10
                if ng < dist.get(m, 1 << 60):
                    dist[m] = ng
                    prev[m] = n
                    h = 0
                    if gx is not None:
                        ddx, ddy = abs(ii - gx), abs(jj - gy)
                        h = 10 * max(ddx, ddy) + 4 * min(ddx, ddy)
                    heapq.heappush(heap, (ng + h * 12 // 10, ng, m))
            # via
            o = (1 - l) * N + rem
            if not vblkf[rem] and not blkf[o]:
                ng = g + via_cost
                if ng < dist.get(o, 1 << 60):
                    dist[o] = ng
                    prev[o] = n
                    h = 0
                    if gx is not None:
                        ddx, ddy = abs(i - gx), abs(j - gy)
                        h = 10 * max(ddx, ddy) + 4 * min(ddx, ddy)
                    heapq.heappush(heap, (ng + h * 12 // 10, ng, o))
        return None

    @staticmethod
    def _path(prev, n, N):
        out = []
        while n != -1:
            l, rem = divmod(n, N)
            j, i = divmod(rem, W)
            out.append((l, j, i))
            n = prev[n]
        return out[::-1]

    # -------------------------------------------------------- pre-routes ----
    def fixed_track(self, net, layer, pts, width):
        k = self.nid(net)
        for a, b in zip(pts, pts[1:]):
            A = (a[0] + OX, a[1] + OY); B = (b[0] + OX, b[1] + OY)
            self.tracks.append((net, layer, A, B, width))
            self._paint_segment(k, layer, A, B, width / 2)

    def fixed_via(self, net, pos, dia):
        k = self.nid(net)
        P = (pos[0] + OX, pos[1] + OY)
        self.vias.append((net, P, dia))
        self.viamask[int((P[1] - OY) / G), int((P[0] - OX) / G)] = True
        for l in (0, 1):
            self._paint_segment(k, l, P, P, dia / 2)
        i, j = int((P[0] - OX) / G), int((P[1] - OY) / G)
        for dx, dy in disk(dia / 2 / G + 0.5):
            self.padmask[j + dy, i + dx] = True       # no other vias on top of it

    def pseudo_pad(self, net, ref, pos, layers):
        """Replace the pads of `ref` on `net` by one end point of a pre-route."""
        self.pads[net] = [p for p in self.pads[net] if p["ref"] != ref]
        P = (pos[0] + OX, pos[1] + OY)
        i, j = int((P[0] - OX) / G), int((P[1] - OY) / G)
        self.pads[net].append(dict(ref=ref, num="pre", layers=layers, cells=[(i, j)], center=P,
                                   smd=len(layers) == 1))

    def preroute_usb(self):
        """Hand-made fan-out of the 0.5 mm pitch USB-C pads (board-local mm).
        D+  : B6/A6 joined on F.Cu below the pad row
        D-  : A7 drops to a via between the D+ stubs, jumps on B.Cu to B7
        VBUS: both VBUS pads -> vias -> joined on B.Cu
        """
        from placement import P
        X, Y, _ = P["J1"]            # pads are at x = X - local_x (rotated 180)
        dx = X - 47.0
        x = lambda v: v + dx
        y0 = Y + 4.77                 # pad bottom edge (8.645 + 0.725 when Y = 4.6)
        yend = Y + 9.0
        w = 0.2
        self.fixed_track("USB_DP", 0, [(x(46.25), y0), (x(46.25), Y + 6.1), (x(47.25), Y + 6.1), (x(47.25), y0)], w)
        self.fixed_track("USB_DP", 0, [(x(46.25), Y + 6.1), (x(46.25), yend)], w)
        self.fixed_track("USB_DN", 0, [(x(46.75), y0), (x(46.75), Y + 5.3)], w)
        self.fixed_via("USB_DN", (x(46.75), Y + 5.3), 0.5)
        self.fixed_track("USB_DN", 1, [(x(46.75), Y + 5.3), (x(46.75), Y + 6.0), (x(47.75), Y + 7.0)], w)
        self.fixed_track("USB_DN", 0, [(x(47.75), y0), (x(47.75), yend)], w)
        self.fixed_via("USB_DN", (x(47.75), Y + 7.0), 0.5)
        self.fixed_track("CC1", 0, [(x(48.25), y0), (x(48.25), Y + 5.9), (x(48.65), Y + 6.3), (x(48.65), yend)], w)
        self.fixed_track("CC2", 0, [(x(45.25), y0), (x(45.25), yend)], w)
        self.fixed_track("VBUS", 0, [(x(44.55), y0), (x(44.55), Y + 8.0)], 0.5)
        self.fixed_track("VBUS", 0, [(x(49.45), y0), (x(49.45), Y + 8.0)], 0.5)
        self.fixed_via("VBUS", (x(44.55), Y + 8.0), 0.6)
        self.fixed_via("VBUS", (x(49.45), Y + 8.0), 0.6)
        self.fixed_track("VBUS", 1, [(x(44.55), Y + 8.0), (x(49.45), Y + 8.0)], 0.5)
        self.pseudo_pad("USB_DP", "J1", (x(46.25), yend), [0])
        self.pseudo_pad("USB_DN", "J1", (x(47.75), yend), [0])
        self.pseudo_pad("CC1", "J1", (x(48.65), yend), [0])
        self.pseudo_pad("CC2", "J1", (x(45.25), yend), [0])
        self.pseudo_pad("VBUS", "J1", (x(44.55), Y + 8.0), [0, 1])
        self.pads["VBUS"].append(dict(ref="J1", num="pre2", layers=[0, 1],
                                      cells=[(int((x(49.45)) / G), int((Y + 8.0) / G))],
                                      center=(x(49.45) + OX, Y + 8.0 + OY), smd=False))

    # ----------------------------------------------------------- commit ----
    def commit(self, net, path, width, tree):
        k = self.nid(net)
        hw = width / 2
        # split into runs on one layer, vias at layer changes
        runs = []
        cur = [path[0]]
        for p in path[1:]:
            if p[0] != cur[-1][0]:
                runs.append(cur)
                x, y = cell_center(p[2], p[1])
                self.vias.append((net, (x, y), VIA_D))
                self.viamask[p[1], p[2]] = True
                for l in (0, 1):
                    jj, ii = self._paint_segment(k, l, (x, y), (x, y), VIA_D / 2)
                    tree[l, jj, ii] = True
                cur = [p]
            else:
                cur.append(p)
        runs.append(cur)
        for run in runs:
            l = run[0][0]
            if len(run) == 1:
                continue
            # merge collinear steps
            pts = [run[0]]
            for a, b, c in zip(run, run[1:], run[2:]):
                if (b[1] - a[1], b[2] - a[2]) != (c[1] - b[1], c[2] - b[2]):
                    pts.append(b)
            pts.append(run[-1])
            for a, b in zip(pts, pts[1:]):
                A = cell_center(a[2], a[1]); B = cell_center(b[2], b[1])
                self.tracks.append((net, l, A, B, width))
                jj, ii = self._paint_segment(k, l, A, B, hw)
                tree[l, jj, ii] = True

    # ------------------------------------------------------------- nets ----
    def route_net(self, net, width, bcost=1.6, via_cost=60):
        pads = self.pads[net]
        k = self.nid(net)
        hw = width / 2
        blk, vblk = self._blocked(k, hw)
        tree = np.zeros((2, H, W), dtype=bool)
        # start the tree at the pad closest to the centroid
        cx = sum(p["center"][0] for p in pads) / len(pads)
        cy = sum(p["center"][1] for p in pads) / len(pads)
        order = sorted(pads, key=lambda p: (p["center"][0] - cx) ** 2 + (p["center"][1] - cy) ** 2)
        first = order[0]
        for (i, j) in first["cells"]:
            for l in first["layers"]:
                tree[l, j, i] = True
        todo = order[1:]
        ok = True
        while todo:
            # next pad = closest to any tree cell (approx by centre distance to tree bbox points)
            ts = np.nonzero(tree.any(axis=0))
            tx = OX + (ts[1] + 0.5) * G; ty = OY + (ts[0] + 0.5) * G

            def dtree(p):
                return float(np.min((tx - p["center"][0]) ** 2 + (ty - p["center"][1]) ** 2))
            todo.sort(key=dtree)
            p = todo.pop(0)
            # already touching the tree?
            if any(tree[l, j, i] for (i, j) in p["cells"] for l in p["layers"]):
                continue
            starts = [(l, j, i) for (i, j) in p["cells"] for l in p["layers"] if not blk[l, j, i]]
            if not starts:
                c = p["cells"][len(p["cells"]) // 2]
                starts = [(l, c[1], c[0]) for l in p["layers"]]
            # prefer the pad centre
            cxi, cyj = int((p["center"][0] - OX) / G), int((p["center"][1] - OY) / G)
            starts.sort(key=lambda s: (s[1] - cyj) ** 2 + (s[2] - cxi) ** 2)
            starts = starts[:1] + [s for s in starts[1:] if (s[1] - cyj) ** 2 + (s[2] - cxi) ** 2 <= 4]
            path = self.astar(starts, tree, blk, vblk, bcost, via_cost)
            if path is None:
                ok = False
                self.failed.append((net, p["ref"], p["num"]))
                continue
            for (i, j) in p["cells"]:
                for l in p["layers"]:
                    tree[l, j, i] = True
            self.commit(net, path, width, tree)
        return ok

    def fanout_gnd(self):
        net = "GND"
        k = self.nid(net)
        n_ok = 0
        for p in self.pads[net]:
            if not p["smd"] or (p["ref"], p["num"]) in self.fanned:
                continue
            for width in (WIDTH["GND"], 0.25):
                if self._fanout_one(p, k, width):
                    n_ok += 1
                    break
            else:
                self.failed.append((net, p["ref"], p["num"]))
        return n_ok

    def fanout_first(self, keys):
        """Fan out selected GND pads before any signal routing."""
        k = self.nid("GND")
        for p in self.pads["GND"]:
            if (p["ref"], p["num"]) in keys:
                for width in (WIDTH["GND"], 0.25):
                    if self._fanout_one(p, k, width):
                        self.fanned.add((p["ref"], p["num"]))
                        break

    def _fanout_one(self, p, k, width):
        hw = width / 2
        blk, vblk = self._blocked(k, hw)
        cxi, cyj = int((p["center"][0] - OX) / G), int((p["center"][1] - OY) / G)
        starts = [(0, cyj, cxi)] if not blk[0, cyj, cxi] else \
            [(0, j, i) for (i, j) in p["cells"] if not blk[0, j, i]][:3]
        if not starts:
            return False
        path = self.astar(starts, None, blk, vblk, 3.0, 0, goal_is_via=True)
        if path is None or len(path) > 80:
            # fallback: join any other GND copper (e.g. a neighbouring GND pad with a via)
            goal = self.owner == k
            for (i, j) in p["cells"]:
                goal[0, j, i] = False
            path = self.astar(starts, goal, blk, vblk, 3.0, 40)
            if path is None:
                return False
        self.commit("GND", path, width, np.zeros((2, H, W), dtype=bool))
        return True


def tidy_tracks(board, tracks, vias):
    """Remove duplicate segments and turn T-junctions into real junctions (split
    the joined segment at the projection point) so KiCad sees no dangling ends."""
    seen, out = set(), []
    for t in tracks:
        net, l, A, B, w = t
        key = (net, l, w) + tuple(sorted([(round(A[0], 3), round(A[1], 3)), (round(B[0], 3), round(B[1], 3))]))
        if key in seen or (abs(A[0] - B[0]) < 1e-6 and abs(A[1] - B[1]) < 1e-6):
            continue
        seen.add(key)
        out.append(list(t))
    pads = [p for fp in board.GetFootprints() for p in fp.Pads()]

    def on_pad(net, l, P):
        L = pcbnew.F_Cu if l == 0 else pcbnew.B_Cu
        v = pcbnew.VECTOR2I(mm(P[0]), mm(P[1]))
        return any(p.GetNetname() == net and p.IsOnLayer(L) and p.HitTest(v, 0) for p in pads)

    def anchored(net, l, P, me):
        for k, t in enumerate(out):
            if k != me and t[0] == net and t[1] == l and (math.dist(t[2], P) < 1e-3 or math.dist(t[3], P) < 1e-3):
                return True
        if any(v[0] == net and math.dist(v[1], P) < 1e-3 for v in vias):
            return True
        return on_pad(net, l, P)

    changed = True
    while changed:
        changed = False
        for me in range(len(out)):
            net, l, A, B, w = out[me]
            for end in (0, 1):
                P = (A, B)[end]
                if anchored(net, l, P, me):
                    continue
                # find a same-net segment whose copper contains P
                for k, t in enumerate(out):
                    if k == me or t[0] != net or t[1] != l:
                        continue
                    (x1, y1), (x2, y2) = t[2], t[3]
                    dx, dy = x2 - x1, y2 - y1
                    L2 = dx * dx + dy * dy
                    if L2 == 0:
                        continue
                    u = max(0.0, min(1.0, ((P[0] - x1) * dx + (P[1] - y1) * dy) / L2))
                    Q = (x1 + u * dx, y1 + u * dy)
                    if math.dist(P, Q) > t[4] / 2:
                        continue
                    # split t at Q, extend me to Q
                    out[k] = [t[0], t[1], t[2], Q, t[4]]
                    out.append([t[0], t[1], Q, t[3], t[4]])
                    if math.dist(P, Q) > 1e-6:
                        out.append([net, l, P, Q, w])
                    changed = True
                    break
                if changed:
                    break
            if changed:
                break
    return [tuple(t) for t in out if math.dist(t[2], t[3]) > 1e-6]


def run_pass(board, base, order, bcost, via_cost, verbose=False):
    r = Router(board, base)
    for n in order:
        w = WIDTH.get(n, DEFAULT_W)
        ok = r.route_net(n, w, bcost, via_cost)
        if not ok and w > DEFAULT_W:
            k = r.nid(n)
            r.owner[r.owner == k] = 0
            for pdl in r.pads[n]:
                for (i, j) in pdl["cells"]:
                    for l in pdl["layers"]:
                        r.owner[l, j, i] = k
            r.tracks = [t for t in r.tracks if t[0] != n]
            r.vias = [v for v in r.vias if v[0] != n]
            r.failed = [f for f in r.failed if f[0] != n]
            ok = r.route_net(n, DEFAULT_W, bcost, via_cost)
        if verbose:
            print(f"  {n:10s} {'ok' if ok else 'FAILED'}", flush=True)
    return r


def main():
    board = pcbnew.LoadBoard(PCB)
    if len(board.GetTracks()):
        raise SystemExit("board already routed: run `make_pcb.py place` first")
    probe = Router(board)
    probe.preroute_usb()
    probe.fanout_first({("U1", "2"), ("U6", "2"), ("U2", "3"), ("U2", "9"), ("U3", "2"), ("Q2", "2"),
                        ("Q3", "2"), ("C8", "2"), ("C7", "2")})
    print("pre-fanned GND pads:", sorted(probe.fanned))
    nets = [n for n in probe.pads if n != "GND" and len(probe.pads[n]) > 1]
    nets.sort(key=lambda n: (ORDER_FIRST.index(n) if n in ORDER_FIRST else 99, len(probe.pads[n])))
    best = None
    order = list(nets)
    for it in range(int(sys.argv[1]) if len(sys.argv) > 1 else 12):
        bcost, via_cost = (1.6, 60) if it % 2 == 0 else (1.25, 35)
        r = run_pass(board, probe, order, bcost, via_cost)
        failed_nets = []
        for f in r.failed:
            if f[0] not in failed_nets:
                failed_nets.append(f[0])
        score = (len(r.failed), len(r.vias), sum(math.dist(t[2], t[3]) for t in r.tracks))
        print(f"pass {it}: failed={len(r.failed)} vias={len(r.vias)} {failed_nets}", flush=True)
        if best is None or score < best[0]:
            best = (score, r)
        if not r.failed:
            break
        # failed nets go first next time
        order = failed_nets + [n for n in order if n not in failed_nets]
    r = best[1]
    print("GND fan-out vias:", r.fanout_gnd())
    r.tracks = tidy_tracks(board, r.tracks, r.vias)
    for net, l, A, B, w in r.tracks:
        t = pcbnew.PCB_TRACK(board)
        t.SetStart(pcbnew.VECTOR2I(mm(A[0]), mm(A[1])))
        t.SetEnd(pcbnew.VECTOR2I(mm(B[0]), mm(B[1])))
        t.SetWidth(mm(w)); t.SetLayer(pcbnew.F_Cu if l == 0 else pcbnew.B_Cu)
        t.SetNet(board.FindNet(net)); board.Add(t)
    for net, (x, y), dia in r.vias:
        v = pcbnew.PCB_VIA(board)
        v.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
        v.SetWidth(mm(dia)); v.SetDrill(mm(VIA_DRILL))
        v.SetNet(board.FindNet(net)); board.Add(v)
    pcbnew.SaveBoard(PCB, board)
    print("tracks:", len(r.tracks), "vias:", len(r.vias))
    if r.failed:
        print("FAILED connections:", r.failed)


if __name__ == "__main__":
    main()

"""Build e220_carrier.kicad_pcb from design.py + placement.py using the KiCad 7
pcbnew Python API, then (optionally) autoroute with Freerouting.

usage:
  python3 make_pcb.py place            # footprints, nets, outline -> e220_carrier.kicad_pcb + .dsn
  python3 make_pcb.py finish <ses>     # import Freerouting session, pour GND, save
"""
import os
import re
import sys

import pcbnew

import design
import placement as pl
from make_sch import uid

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
PCB = os.path.join(ROOT, "e220_carrier.kicad_pcb")
OX, OY = 100.0, 60.0          # board origin on the KiCad page

mm = pcbnew.FromMM


def V(x, y):
    return pcbnew.VECTOR2I(mm(x + OX), mm(y + OY))


POWER_NETS = ["GND", "VBUS", "VSYS", "VBAT", "VSW", "+3V3", "V12", "MT_SW", "BUZ_N", "SIREN_N"]
RF_NETS = ["ANT"]


def fp_dir(lib):
    if lib == "e220_carrier":
        return os.path.join(ROOT, "lib", "e220_carrier.pretty")
    return f"/usr/share/kicad/footprints/{lib}.pretty"


def outline(board):
    w, h, r = pl.BOARD_W, pl.BOARD_H, pl.CORNER_R

    def seg(x1, y1, x2, y2):
        s = pcbnew.PCB_SHAPE(board, pcbnew.SHAPE_T_SEGMENT)
        s.SetStart(V(x1, y1)); s.SetEnd(V(x2, y2))
        s.SetLayer(pcbnew.Edge_Cuts); s.SetWidth(mm(0.1)); board.Add(s)

    def arc(cx, cy, sx, sy, ex, ey):
        s = pcbnew.PCB_SHAPE(board, pcbnew.SHAPE_T_ARC)
        mx = cx + (sx + ex - 2 * cx) / 2 ** 0.5 / 1.0
        # midpoint on the arc
        import math
        a1 = math.atan2(sy - cy, sx - cx); a2 = math.atan2(ey - cy, ex - cx)
        am = (a1 + a2) / 2
        if abs(a2 - a1) > math.pi:
            am += math.pi
        s.SetArcGeometry(V(sx, sy), V(cx + r * math.cos(am), cy + r * math.sin(am)), V(ex, ey))
        s.SetLayer(pcbnew.Edge_Cuts); s.SetWidth(mm(0.1)); board.Add(s)

    seg(r, 0, w - r, 0); seg(w, r, w, h - r); seg(w - r, h, r, h); seg(0, h - r, 0, r)
    arc(w - r, r, w - r, 0, w, r)
    arc(w - r, h - r, w, h - r, w - r, h)
    arc(r, h - r, r, h, 0, h - r)
    arc(r, r, 0, r, r, 0)


def text(board, s, x, y, size=1.0, layer=pcbnew.F_SilkS, angle=0, bold=False):
    t = pcbnew.PCB_TEXT(board)
    t.SetText(s)
    t.SetPosition(V(x, y))
    t.SetLayer(layer)
    t.SetTextSize(pcbnew.VECTOR2I(mm(size), mm(size)))
    t.SetTextThickness(mm(size * (0.2 if bold else 0.15)))
    t.SetTextAngleDegrees(angle)
    if layer == pcbnew.B_SilkS:
        t.SetMirrored(True)
    board.Add(t)


def gnd_zone(board, layer, net):
    z = pcbnew.ZONE(board)
    z.SetLayer(layer)
    z.SetNet(net)
    z.SetIsRuleArea(False)
    z.SetMinThickness(mm(0.2))
    z.SetLocalClearance(mm(0.25))
    z.SetThermalReliefGap(mm(0.25))
    z.SetThermalReliefSpokeWidth(mm(0.4))
    z.SetPadConnection(pcbnew.ZONE_CONNECTION_THERMAL)
    z.SetIslandRemovalMode(pcbnew.ISLAND_REMOVAL_MODE_ALWAYS)
    z.SetAssignedPriority(0)
    m = 0.4
    poly = z.Outline()
    poly.NewOutline()
    for (x, y) in ((m, m), (pl.BOARD_W - m, m), (pl.BOARD_W - m, pl.BOARD_H - m), (m, pl.BOARD_H - m)):
        poly.Append(mm(x + OX), mm(y + OY))
    board.Add(z)
    return z


def place():
    board = pcbnew.BOARD()
    ds = board.GetDesignSettings()
    ds.SetCopperLayerCount(2)
    # JLCPCB-friendly rules (their minimum is 0.127/0.127 mm, 0.3 mm drill)
    ds.m_TrackMinWidth = mm(0.15)
    ds.m_MinClearance = mm(0.2)
    ds.m_HoleToHoleMin = mm(0.5)
    ds.m_ViasMinSize = mm(0.5)
    ds.m_MinThroughDrill = mm(0.3)
    ds.m_CopperEdgeClearance = mm(0.3)
    ds.SetAuxOrigin(V(0, pl.BOARD_H))      # drill/place origin = bottom-left board corner
    nc = ds.m_NetSettings.m_DefaultNetClass
    nc.SetClearance(mm(0.2)); nc.SetTrackWidth(mm(0.4))
    nc.SetViaDiameter(mm(0.6)); nc.SetViaDrill(mm(0.3))

    nets = {}

    def net(name):
        if name not in nets:
            n = pcbnew.NETINFO_ITEM(board, name)
            board.Add(n)
            nets[name] = n
        return nets[name]

    for p in design.parts:
        lib, name = p["fp"].split(":")
        fp = pcbnew.FootprintLoad(fp_dir(lib), name)
        if fp is None:
            raise SystemExit("footprint not found: " + p["fp"])
        fp.SetFPID(pcbnew.LIB_ID(lib, name))
        fp.SetReference(p["ref"])
        fp.SetValue(p["value"])
        fp.SetPath(pcbnew.KIID_PATH("/" + uid("sym", p["ref"])))
        if p["lcsc"]:
            fp.SetProperty("LCSC", p["lcsc"])
        if p["ref"] == "U4":
            # KiCad's ESP32 footprint has 0.2 mm thermal vias at 0.55 mm pitch in the
            # exposed pad; keep 4 of them at 0.3 mm (JLCPCB standard drill, >0.5 mm apart)
            keep = {(0.41, -0.9), (0.41, 1.3), (1.51, -0.9), (1.51, 1.3)}
            for pad in list(fp.Pads()):
                if pad.GetAttribute() == pcbnew.PAD_ATTRIB_PTH and pad.GetNumber() == "19":
                    pos = (round(pcbnew.ToMM(pad.GetPosition().x), 2), round(pcbnew.ToMM(pad.GetPosition().y), 2))
                    if pos in keep:
                        pad.SetDrillSize(pcbnew.VECTOR2I(mm(0.3), mm(0.3)))
                        pad.SetSize(pcbnew.VECTOR2I(mm(0.6), mm(0.6)))
                    else:
                        fp.Remove(pad)
        X, Y, r = pl.P[p["ref"]]
        board.Add(fp)
        fp.SetPosition(V(X, Y))
        fp.SetOrientationDegrees(r)
        for pad in fp.Pads():
            n = p["pins"].get(pad.GetNumber())
            if n:
                pad.SetNet(net(n))
        # keep silkscreen reference small and upright
        ref = fp.Reference()
        ref.SetTextSize(pcbnew.VECTOR2I(mm(0.8), mm(0.8)))
        ref.SetTextThickness(mm(0.12))
        if p["ref"].startswith("H"):
            ref.SetVisible(False)
        fp.Value().SetVisible(False)
    outline(board)

    # silkscreen captions
    text(board, "E220 LoRa Carrier v2.0", 22.5, 44.2, 1.2, bold=True)
    text(board, "SIREN 24V", 67.0, 46.4, 0.8)
    text(board, "+", 65.0, 54.6, 1.0)
    text(board, "I2C", 33.9, 8.3, 0.8, angle=90)
    text(board, "E220 LoRa Carrier rev2.0  2026-11", 36.0, 62.4, 0.8, layer=pcbnew.B_SilkS)

    place_silk_refs(board)
    board.BuildListOfNets()
    pcbnew.SaveBoard(PCB, board)
    dsn = os.path.join("/tmp", "e220_carrier.dsn")   # Freerouting input (not kept)
    os.makedirs(os.path.dirname(dsn), exist_ok=True)
    if not pcbnew.ExportSpecctraDSN(board, dsn):
        raise SystemExit("DSN export failed")
    patch_dsn(dsn)
    print("placed", len(design.parts), "footprints;", len(nets), "nets ->", os.path.relpath(PCB, ROOT))


def _bb(item, inflate=0.0):
    b = item.GetBoundingBox()
    return (toMMf(b.GetLeft()) - inflate, toMMf(b.GetTop()) - inflate,
            toMMf(b.GetRight()) + inflate, toMMf(b.GetBottom()) + inflate)


def toMMf(v):
    return pcbnew.ToMM(v)


def _hit(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def place_silk_refs(board):
    """Move every reference designator to a spot that overlaps no pad and no other
    silkscreen; hide it (keeping it on the fab layer) when nothing fits."""
    obst = []
    for fp in board.GetFootprints():
        for pad in fp.Pads():
            obst.append(_bb(pad, 0.2))
        for g in fp.GraphicalItems():
            if g.GetLayer() == pcbnew.F_SilkS:
                obst.append(_bb(g, 0.1))
    for d in board.GetDrawings():
        if d.GetLayer() == pcbnew.F_SilkS:
            obst.append(_bb(d, 0.15))
    ex0, ey0 = OX + 0.6, OY + 0.6
    ex1, ey1 = OX + pl.BOARD_W - 0.6, OY + pl.BOARD_H - 0.6
    hidden = []
    def fixed_first(f):
        n = str(f.GetFPID().GetLibItemName())
        return (0 if n.startswith(("R_Axial", "D_DO-35", "C_Disc")) else 1, -_bb(f)[2] + _bb(f)[0])
    order = sorted(board.GetFootprints(), key=fixed_first)
    for fp in order:
        ref = fp.Reference()
        name = fp.GetReference()
        if name.startswith("H"):
            continue
        fpname = str(fp.GetFPID().GetLibItemName())
        if name in getattr(pl, "REF_POS", {}):
            x, y = pl.REF_POS[name]
            ref.SetTextAngleDegrees(0)
            ref.SetPosition(pcbnew.VECTOR2I(mm(x + OX), mm(y + OY)))
            obst.append(_bb(ref, 0.05))
            continue
        if name.startswith("A"):            # plug-in modules carry their own silk names
            ref.SetVisible(False)
            continue
        if fpname.startswith(("R_Axial", "D_DO-35", "C_Disc")):
            # inside the body outline, between the two pads
            pads = list(fp.Pads())
            c = (pads[0].GetPosition() + pads[1].GetPosition()) / 2
            ref.SetTextAngleDegrees(0)
            ref.SetPosition(pcbnew.VECTOR2I(int(c.x), int(c.y)))
            if fpname.startswith("D_DO-35"):
                ref.SetPosition(pcbnew.VECTOR2I(int(c.x) + mm(0.6), int(c.y)))
            obst.append(_bb(ref, 0.05))
            continue
        ref.SetTextAngleDegrees(0)
        ref.SetKeepUpright(True)
        crt = _bb(fp)
        cx, cy = (crt[0] + crt[2]) / 2, (crt[1] + crt[3]) / 2
        cands = []
        if name in ("U4", "U5"):
            cands.append((cx, cy + (3 if name == "U4" else -4)))
        d = 0.75
        cands += [(cx, crt[1] - d), (cx, crt[3] + d), (crt[0] - 1.6, cy), (crt[2] + 1.6, cy),
                  (crt[0] - 1.2, crt[1] - d), (crt[2] + 1.2, crt[1] - d),
                  (crt[0] - 1.2, crt[3] + d), (crt[2] + 1.2, crt[3] + d),
                  (cx, crt[1] - d - 0.9), (cx, crt[3] + d + 0.9)]
        done = False
        for (x, y) in cands:
            ref.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
            tb = _bb(ref, 0.05)
            if tb[0] < ex0 or tb[1] < ey0 or tb[2] > ex1 or tb[3] > ey1:
                continue
            if any(_hit(tb, o) for o in obst):
                continue
            obst.append(tb)
            done = True
            break
        if not done:
            ref.SetVisible(False)
            hidden.append(name)
    print("silk refs hidden (no free spot):", " ".join(sorted(hidden)) or "none")


def remove_dangling(board):
    """Drop tiny router stubs whose one end touches nothing."""
    tracks = [t for t in board.GetTracks() if t.Type() == pcbnew.PCB_TRACE_T]
    vias = [t for t in board.GetTracks() if t.Type() == pcbnew.PCB_VIA_T]
    pads = [p for fp in board.GetFootprints() for p in fp.Pads()]
    removed = 0
    for t in tracks:
        if t.GetLength() > mm(0.5):
            continue
        for end in (t.GetStart(), t.GetEnd()):
            touched = any(o is not t and o.GetLayer() == t.GetLayer() and o.HitTest(end, 0)
                          for o in tracks) or any(v.HitTest(end, 0) for v in vias) or \
                any(p.IsOnLayer(t.GetLayer()) and p.HitTest(end, 0) for p in pads)
            if not touched:
                board.Remove(t)
                removed += 1
                break
    print("dangling stubs removed:", removed)


def patch_dsn(path):
    """Add Freerouting net classes: wide power traces, 1.0 mm RF trace."""
    s = open(path).read()
    rule_def = re.search(r"\(class kicad_default(.*?)\(circuit", s, re.S)
    power = " ".join('"%s"' % n if not re.match(r"^[A-Za-z0-9_]+$", n) else n for n in POWER_NETS)
    for n in POWER_NETS + RF_NETS:
        tok = '"%s"' % n if not re.match(r"^[A-Za-z0-9_]+$", n) else n
        # remove from default class
        s = re.sub(r"(\(class kicad_default[^()]*?)\s" + re.escape(tok) + r"(?=[\s)])", r"\1", s, count=1)
    extra = (f'\n    (class power {power}\n      (circuit (use_via "Via[0-1]_600:300_um"))\n'
             f'      (rule (width 500) (clearance 200))\n    )'
             f'\n    (class rf ANT\n      (circuit (use_via "Via[0-1]_600:300_um"))\n'
             f'      (rule (width 1000) (clearance 300))\n    )')
    idx = s.find("(class kicad_default")
    end = s.find("\n    )", idx) + len("\n    )")
    s = s[:end] + extra + s[end:]
    open(path, "w").write(s)


def finish(ses=None):
    board = pcbnew.LoadBoard(PCB)
    if ses and not pcbnew.ImportSpecctraSES(board, ses):
        raise SystemExit("SES import failed")
    gnd = board.FindNet("GND")
    for layer in (pcbnew.F_Cu, pcbnew.B_Cu):
        gnd_zone(board, layer, gnd)
    stitch(board, gnd)
    filler = pcbnew.ZONE_FILLER(board)
    filler.Fill(board.Zones())
    board.BuildConnectivity()
    pcbnew.SaveBoard(PCB, board)
    conn = board.GetConnectivity()
    print("unconnected items:", conn.GetUnconnectedCount(True))
    rpt = os.path.join(ROOT, "docs", "drc_report.txt")
    pcbnew.WriteDRCReport(board, rpt, pcbnew.EDA_UNITS_MILLIMETRES, True)
    print("DRC report ->", os.path.relpath(rpt, ROOT))


def stitch(board, gnd):
    """GND stitching vias on a grid where they don't collide with anything."""
    import math
    pitch = 4.0
    clear = 0.45
    items = []
    for t in board.GetTracks():
        items.append(t)
    pads = [p for fp in board.GetFootprints() for p in fp.Pads()]
    keep = [z for fp in board.GetFootprints() for z in fp.Zones() if z.GetIsRuleArea()]
    n = 0
    y = 2.5
    while y < pl.BOARD_H - 2:
        x = 2.5
        while x < pl.BOARD_W - 2:
            pos = V(x, y)
            ok = True
            for z in keep:
                if z.Outline().Collide(pos, mm(1.0)):
                    ok = False; break
            if ok:
                for p in pads:
                    if p.HitTest(pos, mm(0.3 + clear + 0.2)):
                        ok = False; break
                    bb = p.GetBoundingBox()
                    bb.Inflate(mm(0.3 + clear))
                    if bb.Contains(pos):
                        ok = False; break
            if ok:
                for t in items:
                    if t.HitTest(pos, mm(0.3 + clear) + t.GetWidth() // 2):
                        ok = False; break
            if ok:
                for fp in board.GetFootprints():
                    if fp.GetReference().startswith("H"):
                        if (fp.GetPosition() - pos).EuclideanNorm() < mm(3.6):
                            ok = False
            if ok:
                v = pcbnew.PCB_VIA(board)
                v.SetPosition(pos); v.SetWidth(mm(0.6)); v.SetDrill(mm(0.3))
                v.SetNet(gnd); board.Add(v); n += 1
            x += pitch
        y += pitch
    print("stitching vias:", n)


if __name__ == "__main__":
    if sys.argv[1] == "place":
        place()
    else:
        finish(sys.argv[2] if len(sys.argv) > 2 else None)

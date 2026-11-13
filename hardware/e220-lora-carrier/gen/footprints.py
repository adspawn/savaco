"""Custom footprints for the carrier board (lib/e220_carrier.pretty).

- ESP32-C3 SuperMini: 2 x 1x8 female sockets, rows 15.24 mm apart (board 18 x 22.52 mm)
  left column (top->bottom, USB up): 5V G 3.3 IO4 IO3 IO2 IO1 IO0  -> pins 1..8
  right column: IO5 IO6 IO7 IO8 IO9 IO10 IO20 IO21                  -> pins 9..16
- E220-900T22S(JP)-EV2: 1x7 female socket on the board's short edge
  (M0 M1 RXD TXD AUX VCC GND, top->bottom), board 36 x 21 mm, SMA on the far end
- MT3608 boost module: 4 wire pads (IN+ IN- / OUT+ OUT-) + outline of the area
  where the module is stuck down with foam tape (works with any module shape)
"""
import os
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "lib", "e220_carrier.pretty")
P = 2.54


def f(v):
    s = ("%.4f" % v).rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def tid():
    return str(uuid.uuid4())


class FP:
    def __init__(self, name, descr, smd=True):
        self.name = name
        self.descr = descr
        self.smd = smd
        self.items = []
        self.xs, self.ys = [], []

    def pad(self, num, kind, shape, x, y, w, h, drill=None, layers=None, rot=0):
        if layers is None:
            layers = '"F.Cu" "F.Paste" "F.Mask"' if kind == "smd" else '"*.Cu" "*.Mask"'
        d = f" (drill {f(drill)})" if drill else ""
        r = f" {f(rot)}" if rot else ""
        extra = " (roundrect_rratio 0.25)" if shape == "roundrect" else ""
        self.items.append(f'  (pad "{num}" {kind} {shape} (at {f(x)} {f(y)}{r}) (size {f(w)} {f(h)}){d} '
                          f'(layers {layers}){extra} (tstamp {tid()}))')
        self.xs += [x - w / 2, x + w / 2]
        self.ys += [y - h / 2, y + h / 2]

    def line(self, x1, y1, x2, y2, layer="F.SilkS", width=0.12):
        self.items.append(f'  (fp_line (start {f(x1)} {f(y1)}) (end {f(x2)} {f(y2)}) '
                          f'(stroke (width {f(width)}) (type solid)) (layer "{layer}") (tstamp {tid()}))')

    def rect(self, x1, y1, x2, y2, layer, width=0.05):
        self.items.append(f'  (fp_rect (start {f(x1)} {f(y1)}) (end {f(x2)} {f(y2)}) '
                          f'(stroke (width {f(width)}) (type solid)) (fill none) (layer "{layer}") (tstamp {tid()}))')

    def circle(self, cx, cy, r, layer="F.SilkS", width=0.12):
        self.items.append(f'  (fp_circle (center {f(cx)} {f(cy)}) (end {f(cx + r)} {f(cy)}) '
                          f'(stroke (width {f(width)}) (type solid)) (fill none) (layer "{layer}") (tstamp {tid()}))')

    def text(self, kind, txt, x, y, layer, hide=False):
        h = " hide" if hide else ""
        self.items.append(f'  (fp_text {kind} "{txt}" (at {f(x)} {f(y)}) (layer "{layer}"){h}\n'
                          f'    (effects (font (size 1 1) (thickness 0.15))) (tstamp {tid()}))')

    def write(self, body=None, court_margin=0.25):
        bx = body or (min(self.xs), min(self.ys), max(self.xs), max(self.ys))
        x0 = min(min(self.xs), bx[0]) - court_margin
        y0 = min(min(self.ys), bx[1]) - court_margin
        x1 = max(max(self.xs), bx[2]) + court_margin
        y1 = max(max(self.ys), bx[3]) + court_margin
        self.rect(x0, y0, x1, y1, "F.CrtYd")
        if body:
            self.rect(*body, "F.Fab", 0.1)
        attr = "smd" if self.smd else "through_hole"
        head = [f'(footprint "{self.name}" (version 20221018) (generator e220_lora_gen)',
                '  (layer "F.Cu")',
                f'  (descr "{self.descr}")',
                f'  (attr {attr})']
        self.text("reference", "REF**", 0, y0 - 1.0, "F.SilkS")
        self.text("value", self.name, 0, y1 + 1.0, "F.Fab")
        self.text("user", "${REFERENCE}", 0, 0, "F.Fab")
        path = os.path.join(OUT, self.name + ".kicad_mod")
        with open(path, "w") as fh:
            fh.write("\n".join(head + self.items) + "\n)\n")
        return path



def socket_pad(fp, num, x, y, first=False):
    fp.pad(num, "thru_hole", "rect" if first else "oval", x, y, 1.7, 1.7, drill=1.0)


def supermini():
    fp = FP("ESP32-C3_SuperMini_Socket", "ESP32-C3 SuperMini on two 1x8 female sockets, rows 15.24mm", smd=False)
    for i in range(8):
        socket_pad(fp, str(1 + i), 0, i * P, first=(i == 0))
        socket_pad(fp, str(9 + i), 15.24, i * P)
    # module outline (18 x 22.52), USB at the top
    x0, x1 = 7.62 - 9, 7.62 + 9
    y0 = 8.89 - 11.26; y1 = 8.89 + 11.26
    fp.rect(x0, y0, x1, y1, "F.SilkS", 0.15)
    fp.rect(7.62 - 4.5, y0 - 1.2, 7.62 + 4.5, y0 + 6.2, "F.SilkS", 0.12)   # USB-C
    fp.text("user", "USB", 7.62, y0 + 2.4, "F.SilkS")
    fp.text("user", "C3 SuperMini", 7.62, 9.5, "F.SilkS")
    for i, n in enumerate(["5V", "G", "3V3", "4", "3", "2", "1", "0"]):
        fp.text("user", n, 2.6 if len(n) < 3 else 3.0, i * P, "F.Fab")
    return fp.write(body=(x0, y0 - 1.2, x1, y1))


def e220_ev2():
    fp = FP("E220-EV2_Socket", "E220-900T22S(JP)-EV2 evaluation board on a 1x7 female socket", smd=False)
    for i in range(7):
        socket_pad(fp, str(1 + i), 0, i * P, first=(i == 0))
    # board outline: header column ~1.6 mm from the left edge, centred vertically
    x0 = -1.6; x1 = x0 + 36.0
    yc = 3 * P
    y0, y1 = yc - 10.5, yc + 10.5
    fp.rect(x0, y0, x1, y1, "F.SilkS", 0.15)
    fp.rect(x1, yc - 3.2, x1 + 12.5, yc + 3.2, "F.Fab", 0.12)    # SMA beyond the board
    fp.text("user", "E220-900T22S(JP)-EV2", 17.0, yc - 2.0, "F.SilkS")
    fp.text("user", "SMA ->", 30.0, yc + 2.5, "F.SilkS")
    for i, n in enumerate(["M0", "M1", "RXD", "TXD", "AUX", "VCC", "GND"]):
        fp.text("user", n, 3.4, i * P, "F.SilkS")
    return fp.write(body=(x0, y0, x1, y1))


def mt3608():
    fp = FP("MT3608_Module_Wired", "MT3608 boost module area; module wired to IN/OUT pads, stuck with foam tape",
            smd=False)
    L = 30.48
    fp.pad("1", "thru_hole", "rect", 0, 0, 2.2, 2.2, drill=1.2)          # IN+
    fp.pad("2", "thru_hole", "circle", 0, P, 2.2, 2.2, drill=1.2)        # IN-
    fp.pad("3", "thru_hole", "rect", L, 0, 2.2, 2.2, drill=1.2)          # OUT+
    fp.pad("4", "thru_hole", "circle", L, P, 2.2, 2.2, drill=1.2)        # OUT-
    fp.rect(2.6, -6.5, L - 2.6, P + 6.5, "F.SilkS", 0.15)
    fp.text("user", "MT3608 module (24V)", L / 2, P / 2 - 1.2, "F.SilkS")
    fp.text("user", "foam tape here", L / 2, P / 2 + 1.4, "F.SilkS")
    fp.text("user", "IN+", -0.2, -2.2, "F.SilkS")
    fp.text("user", "IN-", -0.2, P + 2.2, "F.SilkS")
    fp.text("user", "OUT+", L + 0.2, -2.2, "F.SilkS")
    fp.text("user", "OUT-", L + 0.2, P + 2.2, "F.SilkS")
    return fp.write(body=(-1.6, -6.5, L + 1.6, P + 6.5))


def main():
    os.makedirs(OUT, exist_ok=True)
    for p in (supermini(), e220_ev2(), mt3608()):
        print("wrote", os.path.relpath(p, HERE))


if __name__ == "__main__":
    main()

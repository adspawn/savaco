"""Generate custom footprints into lib/e220_lora.pretty.

- E220-900T22S(JP): drawn from the CLEALINK datasheet (Rev2.1.2, Fig.51
  recommended footprint): 22 castellated pads, 1.27 mm pitch, pad rows at
  +/-7.1 mm, 16 x 26 mm body.
- Other LCSC parts: converted from the public EasyEDA package data of the
  exact LCSC part number (gen/easyeda/Cxxxx.json), 1 unit = 10 mil.
"""
import json
import os
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "lib", "e220_lora.pretty")
U = 0.254  # EasyEDA unit -> mm


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


# ---------------------------------------------------------------- E220 ----
E220_PAD_X = 7.1     # pad row centre (datasheet Fig.51: 14.2 mm between rows)
E220_PAD_W = 2.2     # 1.8 mm recommended, lengthened outward for hand soldering
E220_PAD_H = 0.8


def e220_pad_positions():
    """Pin -> (x, y). Origin = module centre, RF end (pins 1-3/20-22) at -Y."""
    pos = {}
    top = -13.0
    rf = [top + 1.4 + i * 1.27 for i in range(3)]            # pins 1-3 / 22-20
    dig = [top + 26.0 - 1.97 - (7 - i) * 1.27 for i in range(8)]  # pins 4-11 / 19-12
    for i, y in enumerate(rf):
        pos[str(1 + i)] = (-E220_PAD_X, y)
        pos[str(22 - i)] = (E220_PAD_X, y)
    for i, y in enumerate(dig):
        pos[str(4 + i)] = (-E220_PAD_X, y)
        pos[str(19 - i)] = (E220_PAD_X, y)
    return pos


def make_e220():
    fp = FP("E220-900T22S_JP", "CLEALINK E220-900T22S(JP) 920MHz LoRa module, 22-pin castellated, "
            "16x26mm, P1.27mm (datasheet Rev2.1.2 Fig.51)")
    for num, (x, y) in e220_pad_positions().items():
        off = 0.2 if x > 0 else -0.2   # shift outward
        fp.pad(num, "smd", "rect", x + off, y, E220_PAD_W, E220_PAD_H)
    fp.rect(-8, -13, 8, 13, "F.SilkS", 0.12)
    # RF-end marker and pin-1 dot
    fp.line(-8, -7.3, 8, -7.3, "F.SilkS", 0.12)
    fp.circle(-9.3, -11.6, 0.3, "F.SilkS", 0.3)
    fp.text("user", "RF", 0, -10.3, "F.SilkS")
    fp.text("user", "E220-900T22S(JP)", 0, 3, "F.Fab")
    return fp.write(body=(-8, -13, 8, 13))


# ------------------------------------------------------------ EasyEDA ----
def from_easyeda(lcsc, name, descr, renumber=None, smd=True, body=None, silk=True):
    with open(os.path.join(HERE, "easyeda", lcsc + ".json")) as fh:
        ds = json.load(fh)["result"]["packageDetail"]["dataStr"]
    ox, oy = float(ds["head"]["x"]), float(ds["head"]["y"])
    fp = FP(name, descr + f" (LCSC {lcsc}, converted from EasyEDA package)", smd)
    for s in ds["shape"]:
        a = s.split("~")
        if a[0] == "PAD":
            shape, x, y, w, h, layer, num = a[1], float(a[2]), float(a[3]), float(a[4]), float(a[5]), a[6], a[8]
            hole_r = float(a[9] or 0)
            if renumber is not None and num in renumber:
                num = renumber[num]
            px, py = (x - ox) * U, (y - oy) * U
            if shape == "RECT" and a[10]:
                pts = [float(v) for v in a[10].split()]
                xs, ys = pts[0::2], pts[1::2]
                w, h = (max(xs) - min(xs)), (max(ys) - min(ys))
            if layer == "1":
                fp.pad(num, "smd", "roundrect" if shape == "RECT" else "circle" if shape == "ELLIPSE" else "rect",
                       px, py, w * U, h * U)
            else:
                kind = "thru_hole"
                fp.pad(num, kind, "circle" if shape == "ELLIPSE" else "rect", px, py, w * U, h * U,
                       drill=2 * hole_r * U)
        elif a[0] == "HOLE":
            x, y, r = float(a[1]), float(a[2]), float(a[3])
            fp.pad("", "np_thru_hole", "circle", (x - ox) * U, (y - oy) * U, 2 * r * U, 2 * r * U,
                   drill=2 * r * U, layers='"*.Cu" "*.Mask"')
        elif a[0] == "TRACK" and a[2] == "3" and silk:
            pts = [float(v) for v in a[4].split()]
            for i in range(0, len(pts) - 2, 2):
                fp.line((pts[i] - ox) * U, (pts[i + 1] - oy) * U, (pts[i + 2] - ox) * U, (pts[i + 3] - oy) * U)
        elif a[0] == "CIRCLE" and a[5] == "3" and silk:
            fp.circle((float(a[1]) - ox) * U, (float(a[2]) - oy) * U, float(a[3]) * U)
    return fp.write(body=body)


def main():
    os.makedirs(OUT, exist_ok=True)
    paths = [make_e220(),
             from_easyeda("C16581", "ESOP-8_TP4056", "TP4056 ESOP-8 with exposed pad"),
             from_easyeda("C94599", "Buzzer_MLT-8530", "MLT-8530 8.5x8.5mm SMD magnetic transducer",
                          renumber={"3": "", "4": ""}),
             from_easyeda("C431541", "SW_MSK12C02", "MSK12C02 SPDT slide switch", renumber={"4": ""}),
             # Tactile switch: use diagonal pads 1 and 4 only, so the switch works
             # regardless of which pad pairs are internally bridged.
             from_easyeda("C318884", "SW_TS-1187A", "TS-1187A 5.1x5.1mm tactile switch, diagonal pads used",
                          renumber={"1": "1", "4": "2", "2": "", "3": ""}),
             from_easyeda("C496549", "SMA_BWSMA-KE-Z001", "SMA vertical THT jack", smd=False,
                          renumber={"5": "1", "1": "2", "2": "2", "3": "2", "4": "2"}),
             ]
    for p in paths:
        print("wrote", os.path.relpath(p, HERE))


if __name__ == "__main__":
    main()

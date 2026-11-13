"""Symbol handling: load KiCad library symbols (flattening `extends`) and build
simple box symbols for parts that are not in the KiCad 7 stock library."""
import copy
import os
from sexp import Sym, parse, find, findall

KICAD_SYM_DIR = "/usr/share/kicad/symbols"
_lib_cache = {}


def _load_lib(lib):
    if lib not in _lib_cache:
        with open(os.path.join(KICAD_SYM_DIR, lib + ".kicad_sym")) as f:
            tree = parse(f.read())
        _lib_cache[lib] = {s[1]: s for s in findall(tree, "symbol")}
    return _lib_cache[lib]


def load_symbol(lib_id):
    """Return a flattened symbol s-expr named 'lib:name'."""
    lib, name = lib_id.split(":")
    syms = _load_lib(lib)
    sym = copy.deepcopy(syms[name])
    ext = find(sym, "extends")
    if ext:
        parent = load_symbol(lib + ":" + ext[1])
        pname = parent[1].split(":")[1]
        # start from parent, override properties with derived ones
        new = [Sym("symbol"), name]
        for item in parent[2:]:
            if isinstance(item, list) and item[0] == "property":
                continue
            if isinstance(item, list) and item[0] == "symbol":
                unit = copy.deepcopy(item)
                unit[1] = unit[1].replace(pname, name, 1)
                new.append(unit)
            else:
                new.append(copy.deepcopy(item))
        props = findall(sym, "property")
        # insert properties right after flags (before units)
        idx = next(i for i, x in enumerate(new) if isinstance(x, list) and x[0] == "symbol")
        new[idx:idx] = props
        sym = new
    sym[1] = lib_id
    return sym


def symbol_pins(sym):
    """Return {pin_number: (x, y, angle, length, name, etype)} for unit 1 style 1."""
    pins = {}
    name = sym[1].split(":")[1]
    for unit in findall(sym, "symbol"):
        uname = unit[1]
        parts = uname.rsplit("_", 2)
        u, s = int(parts[1]), int(parts[2])
        if u not in (0, 1) or s not in (0, 1):
            continue
        for p in findall(unit, "pin"):
            at = find(p, "at")
            num = find(p, "number")[1]
            nm = find(p, "name")[1]
            ln = find(p, "length")[1]
            pins[num] = (float(at[1]), float(at[2]), float(at[3]) if len(at) > 3 else 0.0,
                         float(ln), nm, str(p[1]))
    return pins


def symbol_bbox(sym):
    """Rough bounding box (x0,y0,x1,y1) in symbol coords (y up) incl. pins."""
    xs, ys = [], []

    def walk(e):
        if isinstance(e, list) and e:
            if e[0] in ("rectangle",):
                for k in ("start", "end"):
                    v = find(e, k)
                    xs.append(float(v[1])); ys.append(float(v[2]))
            elif e[0] in ("polyline",):
                pts = find(e, "pts")
                for xy in findall(pts, "xy"):
                    xs.append(float(xy[1])); ys.append(float(xy[2]))
            elif e[0] == "circle":
                c = find(e, "center"); r = float(find(e, "radius")[1])
                xs += [float(c[1]) - r, float(c[1]) + r]; ys += [float(c[2]) - r, float(c[2]) + r]
            elif e[0] == "pin":
                at = find(e, "at")
                xs.append(float(at[1])); ys.append(float(at[2]))
            for x in e:
                walk(x)
    for unit in findall(sym, "symbol"):
        walk(unit)
    if not xs:
        return (-2.54, -2.54, 2.54, 2.54)
    return (min(xs), min(ys), max(xs), max(ys))


def _font(size=1.27):
    return [Sym("effects"), [Sym("font"), [Sym("size"), size, size]]]


def box_symbol(lib_id, ref, value, left, right, top=(), bottom=(), width=15.24,
               footprint="", datasheet="", description=""):
    """Build a box symbol.

    left/right/top/bottom: lists of (number, name, etype) or None for a gap.
    etype: input/output/bidirectional/power_in/power_out/passive/no_connect
    """
    pitch = 2.54
    plen = 2.54
    nside = max(len(left), len(right), 1)
    h = (nside + 1) * pitch
    if top or bottom:
        nb = max(len(top), len(bottom))
        width = max(width, (nb + 1) * pitch)
    # snap to grid
    w = round(width / pitch) * pitch
    if (w / pitch) % 2:
        w += pitch
    h = round(h / pitch) * pitch
    x0, x1 = -w / 2, w / 2
    y1 = h / 2
    y0 = -h / 2
    y1 = round(y1 / pitch) * pitch
    y0 = y1 - h
    name = lib_id.split(":")[1]
    pins = []

    def pin(num, nm, et, x, y, ang):
        # num may be a list -> stacked pins at the same spot (extra ones hidden)
        nums = num if isinstance(num, (list, tuple)) else [num]
        for k, n in enumerate(nums):
            p = [Sym("pin"), Sym(et), Sym("line"), [Sym("at"), x, y, ang],
                 [Sym("length"), plen]]
            if k:
                p.append(Sym("hide"))
            p += [[Sym("name"), nm, _font()], [Sym("number"), n, _font()]]
            pins.append(p)

    for i, p in enumerate(left):
        if p:
            pin(p[0], p[1], p[2], x0 - plen, y1 - pitch * (i + 1), 0)
    for i, p in enumerate(right):
        if p:
            pin(p[0], p[1], p[2], x1 + plen, y1 - pitch * (i + 1), 180)
    nt = len(top)
    for i, p in enumerate(top):
        if p:
            x = (i - (nt - 1) / 2) * pitch
            x = round(x / pitch) * pitch if nt % 2 else round((x - pitch / 2) / pitch) * pitch + pitch / 2
            pin(p[0], p[1], p[2], x, y1 + plen, 270)
    nb = len(bottom)
    for i, p in enumerate(bottom):
        if p:
            x = (i - (nb - 1) / 2) * pitch
            x = round(x / pitch) * pitch if nb % 2 else round((x - pitch / 2) / pitch) * pitch + pitch / 2
            pin(p[0], p[1], p[2], x, y0 - plen, 90)

    def prop(k, v, x, y, hide=False):
        eff = _font()
        if not hide:
            eff.append([Sym("justify"), Sym("left"), Sym("bottom")])
        if hide:
            eff.append(Sym("hide"))
        return [Sym("property"), k, v, [Sym("at"), x, y, 0], eff]

    sym = [Sym("symbol"), lib_id,
           [Sym("in_bom"), Sym("yes")], [Sym("on_board"), Sym("yes")],
           prop("Reference", ref, x0, y1 + 3.81 + (plen if top else 0)),
           prop("Value", value, x0, y1 + 1.27 + (plen if top else 0)),
           prop("Footprint", footprint, 0, 0, True),
           prop("Datasheet", datasheet, 0, 0, True),
           [Sym("symbol"), name + "_0_1",
            [Sym("rectangle"), [Sym("start"), x0, y1], [Sym("end"), x1, y0],
             [Sym("stroke"), [Sym("width"), 0.254], [Sym("type"), Sym("default")]],
             [Sym("fill"), [Sym("type"), Sym("background")]]]],
           [Sym("symbol"), name + "_1_1"] + pins]
    if description:
        sym.insert(8, prop("ki_description", description, 0, 0, True))
    return sym

"""Generate e220_carrier.kicad_sch (KiCad 7) + lib/e220_carrier.kicad_sym from design.py.

Every pin end gets a net label (or a no-connect flag), so connectivity is
fully defined by design.py and verified afterwards with kicad-cli ERC/netlist.
"""
import math
import os
import uuid

import custom_symbols
import design
from sexp import Sym, dump, find, findall
from symbols import load_symbol, symbol_pins

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
PROJECT = "e220_carrier"
# deterministic UUIDs so regenerating keeps sch/pcb links stable
NS = uuid.UUID("6f1c3a52-9a7e-4f43-9d1e-2b0f0e220c02")


def uid(*key):
    return str(uuid.uuid5(NS, "/".join(map(str, key))))


SHEET_UUID = uid("root-sheet")


def get_symbol(lib_id):
    if lib_id in custom_symbols.ALL:
        return custom_symbols.ALL[lib_id]()
    return load_symbol(lib_id)


def rot(x, y, r):
    a = math.radians(r)
    return (x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a))


def snap(v):
    return round(v / 0.0254) * 0.0254 if False else round(v, 3)


def font(size=1.27, bold=False):
    f = [Sym("font"), [Sym("size"), size, size]]
    if bold:
        f.append(Sym("bold"))
    return f


def label(net, x, y, ang):
    just = {0: "left", 90: "left", 180: "right", 270: "right"}[int(ang) % 360]
    return [Sym("label"), net, [Sym("at"), snap(x), snap(y), int(ang) % 360],
            [Sym("fields_autoplaced")],
            [Sym("effects"), font(), [Sym("justify"), Sym(just), Sym("bottom")]],
            [Sym("uuid"), uid("label", net, round(x, 2), round(y, 2))]]


def pin_world(sym_pins, num, X, Y, r):
    px, py, pang = sym_pins[num][0], sym_pins[num][1], sym_pins[num][2]
    dx, dy = rot(px, py, r)
    return X + dx, Y - dy, (pang + r) % 360


def label_angle(pin_ang):
    # pin angle = direction from connection point into the body
    return {0: 180, 180: 0, 90: 270, 270: 90}[int(round(pin_ang)) % 360]


def prop(name, value, x, y, hide=False, ang=0, justify=None):
    eff = [Sym("effects"), font()]
    if justify:
        eff.append([Sym("justify")] + [Sym(j) for j in justify])
    if hide:
        eff.append(Sym("hide"))
    return [Sym("property"), name, value, [Sym("at"), snap(x), snap(y), ang], eff]


def symbol_instance(p, libsym, sym_pins):
    X, Y, r = p["sch"]
    ref = p["ref"]
    items = [Sym("symbol"), [Sym("lib_id"), p["sym"]], [Sym("at"), X, Y, r], [Sym("unit"), 1],
             [Sym("in_bom"), Sym("yes")], [Sym("on_board"), Sym("yes")],
             [Sym("dnp"), Sym("yes") if p.get("dnp") else Sym("no")],
             [Sym("uuid"), uid("sym", ref)]]
    two_pin = p["sym"] in ("Device:R", "Device:C", "Device:L", "Device:LED", "Device:D", "Diode:SS34")
    fang = 90 if r in (90, 270) else 0   # KiCad adds the symbol rotation to field angles
    lib_props = {pp[1]: pp for pp in findall(libsym, "property")}
    if two_pin:
        # horizontal 2-pin parts: ref above, value below (field angle follows the
        # symbol rotation in KiCad, so pass r to keep the text horizontal)
        items.append(prop("Reference", ref, X, Y - 2.54, ang=fang))
        items.append(prop("Value", p["value"], X, Y + 2.54, ang=fang))
    else:
        for key, val in (("Reference", ref), ("Value", p["value"])):
            at = find(lib_props[key], "at")
            dx, dy = rot(float(at[1]), float(at[2]), r)
            just = None
            eff = find(lib_props[key], "effects")
            j = find(eff, "justify") if eff else None
            if j and r == 0:
                just = [str(s) for s in j[1:]]
            if key == "Value" and p.get("vpos"):
                dx, dy = p["vpos"][0], -p["vpos"][1]
                just = ["left", "bottom"]
            items.append(prop(key, val, X + dx, Y - dy, justify=just, ang=fang))
    items.append(prop("Footprint", p["fp"], X, Y, hide=True))
    items.append(prop("Datasheet", "", X, Y, hide=True))
    if p["lcsc"]:
        items.append(prop("LCSC", p["lcsc"], X, Y, hide=True))
    for num in sym_pins:
        items.append([Sym("pin"), num, [Sym("uuid"), uid("pin", ref, num)]])
    items.append([Sym("instances"), [Sym("project"), PROJECT,
                                     [Sym("path"), "/" + SHEET_UUID, [Sym("reference"), ref], [Sym("unit"), 1]]]])
    return items


def main():
    lib_cache = {}
    for p in design.parts:
        if p["sym"] not in lib_cache:
            lib_cache[p["sym"]] = get_symbol(p["sym"])
    flag_sym = load_symbol("power:PWR_FLAG")
    lib_cache["power:PWR_FLAG"] = flag_sym

    body = []
    labels = []
    nocon = []
    wires = []
    ends = {}  # net -> list of (x, y, label_angle, label_index)
    for p in design.parts:
        libsym = lib_cache[p["sym"]]
        pins = symbol_pins(libsym)
        missing = set(p["pins"]) ^ set(pins)
        if missing:
            raise SystemExit(f"{p['ref']}: pin mismatch {sorted(missing)}")
        body.append(symbol_instance(p, libsym, pins))
        X, Y, r = p["sch"]
        placed = set()
        for num, net in p["pins"].items():
            x, y, pang = pin_world(pins, num, X, Y, r)
            key = (round(x, 2), round(y, 2))
            if key in placed:          # stacked pins share one label
                continue
            placed.add(key)
            if net is None:
                nocon.append([Sym("no_connect"), [Sym("at"), snap(x), snap(y)],
                              [Sym("uuid"), uid("nc", p["ref"], num)]])
            else:
                ends.setdefault(net, []).append((x, y, label_angle(pang), len(labels)))
                labels.append(label(net, x, y, label_angle(pang)))

    # A net with exactly two pins facing each other on the same row gets a
    # wire instead of two labels (e.g. resistor -> LED).
    drop = set()
    for net, e in ends.items():
        if len(e) != 2:
            continue
        (x1, y1, a1, i1), (x2, y2, a2, i2) = sorted(e)
        if abs(y1 - y2) < 0.01 and a1 == 0 and a2 == 180 and x2 - x1 < 30:
            wires.append([Sym("wire"), [Sym("pts"), [Sym("xy"), snap(x1), snap(y1)], [Sym("xy"), snap(x2), snap(y2)]],
                          [Sym("stroke"), [Sym("width"), 0], [Sym("type"), Sym("default")]],
                          [Sym("uuid"), uid("wire", net)]])
            drop |= {i1, i2}
    labels = [l for i, l in enumerate(labels) if i not in drop]
    for w in wires:
        net = [n for n, e in ends.items() if uid("wire", n) == w[-1][1]][0]
        (x1, y1), (x2, y2) = [(float(p[1]), float(p[2])) for p in w[1][1:]]
        labels.append(label(net, round(((x1 + x2) / 2) / 1.27) * 1.27 - 1.27, y1, 0))

    # PWR_FLAGs
    fpins = symbol_pins(flag_sym)
    for i, (net, (X, Y)) in enumerate(design.POWER_FLAGS):
        ref = f"#FLG0{i + 1}"
        body.append([Sym("symbol"), [Sym("lib_id"), "power:PWR_FLAG"], [Sym("at"), X, Y, 0], [Sym("unit"), 1],
                     [Sym("in_bom"), Sym("yes")], [Sym("on_board"), Sym("yes")], [Sym("dnp"), Sym("no")],
                     [Sym("uuid"), uid("sym", ref)],
                     prop("Reference", ref, X, Y - 4, hide=True),
                     prop("Value", "PWR_FLAG", X, Y - 4),
                     prop("Footprint", "", X, Y, hide=True), prop("Datasheet", "", X, Y, hide=True),
                     [Sym("pin"), "1", [Sym("uuid"), uid("pin", ref, "1")]],
                     [Sym("instances"), [Sym("project"), PROJECT, [Sym("path"), "/" + SHEET_UUID,
                                                                   [Sym("reference"), ref], [Sym("unit"), 1]]]]])
        x, y, pang = pin_world(fpins, "1", X, Y, 0)
        labels.append(label(net, x, y, label_angle(pang)))

    # block frames + titles + notes
    gfx = []
    for i, (title, (x0, y0, x1, y1)) in enumerate(design.BLOCKS):
        gfx.append([Sym("rectangle"), [Sym("start"), x0, y0], [Sym("end"), x1, y1],
                    [Sym("stroke"), [Sym("width"), 0.254], [Sym("type"), Sym("dash")]],
                    [Sym("fill"), [Sym("type"), Sym("none")]], [Sym("uuid"), uid("blk", i)]])
        gfx.append([Sym("text"), title, [Sym("at"), x0 + 1.27, y0 + 3.81, 0],
                    [Sym("effects"), font(2.0, True), [Sym("justify"), Sym("left"), Sym("bottom")]],
                    [Sym("uuid"), uid("blktxt", i)]])
    gfx.append([Sym("text"), "NOTES", [Sym("at"), 312.42, 40.64, 0],
                [Sym("effects"), font(2.0, True), [Sym("justify"), Sym("left"), Sym("bottom")]],
                [Sym("uuid"), uid("notes-h")]])
    for i, n in enumerate(design.NOTES):
        # wrap long notes
        lines, cur = [], ""
        for ch in n:
            cur += ch
            if len(cur) >= 34:
                lines.append(cur); cur = ""
        if cur:
            lines.append(cur)
        gfx.append([Sym("text"), f"{i + 1}. " + "\n   ".join(lines), [Sym("at"), 312.42, 46.99 + i * 16.51, 0],
                    [Sym("effects"), font(1.5), [Sym("justify"), Sym("left"), Sym("top")]],
                    [Sym("uuid"), uid("note", i)]])

    sch = [Sym("kicad_sch"), [Sym("version"), 20230121], [Sym("generator"), Sym("eeschema")],
           [Sym("uuid"), SHEET_UUID], [Sym("paper"), "A3"],
           [Sym("title_block"), [Sym("title"), "E220 LoRa Carrier (ESP32-C3 SuperMini + E220-EV2)"],
            [Sym("date"), "2026-11-13"], [Sym("rev"), "1.0"],
            [Sym("comment"), 1, "Plug-in modules, button, 85dB buzzer, 24V siren output, LEDs"],
            [Sym("comment"), 2, "Generated by hardware/e220-lora-carrier/gen/make_sch.py"]],
           [Sym("lib_symbols")] + list(lib_cache.values())]
    sch += gfx + nocon + wires + labels + body
    sch.append([Sym("sheet_instances"), [Sym("path"), "/", [Sym("page"), "1"]]])
    out = os.path.join(ROOT, PROJECT + ".kicad_sch")
    with open(out, "w") as fh:
        fh.write(dump(sch) + "\n")
    print("wrote", os.path.relpath(out, HERE), len(design.parts), "parts,", len(labels), "labels")

    # project symbol library with the custom symbols
    lib = [Sym("kicad_symbol_lib"), [Sym("version"), 20220914], [Sym("generator"), Sym("e220_carrier_gen")]]
    for lib_id, fn in custom_symbols.ALL.items():
        s = fn()
        s[1] = lib_id.split(":")[1]
        lib.append(s)
    with open(os.path.join(ROOT, "lib", "e220_carrier.kicad_sym"), "w") as fh:
        fh.write(dump(lib) + "\n")


if __name__ == "__main__":
    main()

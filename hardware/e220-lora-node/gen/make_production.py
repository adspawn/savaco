"""JLCPCB production files: gerbers + drill (zip), BOM and CPL csv.

usage: python3 make_production.py
"""
import csv
import os
import re
import subprocess
import zipfile

import design

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
PCB = os.path.join(ROOT, "e220_lora.kicad_pcb")
OUT = os.path.join(ROOT, "production")
GERB = os.path.join(OUT, "gerber")

LAYERS = "F.Cu,B.Cu,F.Paste,B.Paste,F.SilkS,B.SilkS,F.Mask,B.Mask,Edge.Cuts"
# KiCad -> JLCPCB placement rotation offsets (footprints converted from EasyEDA
# already use JLCPCB's orientation, so they need none)
ROT_FIX = [(r"^Package_TO_SOT_SMD:SOT-23", 180)]
NOT_ASSEMBLED = {"U5"}            # E220: not stocked by LCSC -> hand solder / consign


def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)


def main():
    os.makedirs(GERB, exist_ok=True)
    for f in os.listdir(GERB):
        os.remove(os.path.join(GERB, f))
    run("kicad-cli", "pcb", "export", "gerbers", "--layers", LAYERS, "--subtract-soldermask",
        "--no-x2", "--use-drill-file-origin", "-o", GERB + "/", PCB)
    run("kicad-cli", "pcb", "export", "drill", "--format", "excellon", "--drill-origin", "plot",
        "--excellon-units", "mm", "--excellon-zeros-format", "decimal", "--excellon-oval-format", "alternate",
        "--generate-map", "--map-format", "pdf", "-o", GERB + "/", PCB)
    zpath = os.path.join(OUT, "e220_lora_gerber_jlcpcb.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(os.listdir(GERB)):
            if not f.endswith(".pdf"):
                z.write(os.path.join(GERB, f), f)
    print("gerber zip:", os.path.relpath(zpath, ROOT), len(os.listdir(GERB)), "files")

    # ---- BOM (JLCPCB format) ----
    groups = {}
    for p in design.parts:
        if not p["lcsc"] or p["ref"] in NOT_ASSEMBLED:
            continue
        key = (p["value"], p["fp"].split(":")[1], p["lcsc"])
        groups.setdefault(key, []).append(p["ref"])

    def natkey(r):
        m = re.match(r"([A-Z]+)(\d+)", r)
        return (m.group(1), int(m.group(2)))
    bom = os.path.join(OUT, "e220_lora_bom_jlcpcb.csv")
    with open(bom, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["Comment", "Designator", "Footprint", "LCSC Part #"])
        for (val, fp, lcsc), refs in sorted(groups.items(), key=lambda kv: natkey(sorted(kv[1], key=natkey)[0])):
            w.writerow([val, ",".join(sorted(refs, key=natkey)), fp, lcsc])
    print("BOM:", os.path.relpath(bom, ROOT), len(groups), "lines")

    # ---- CPL ----
    tmp = os.path.join(OUT, "_pos.csv")
    run("kicad-cli", "pcb", "export", "pos", "--format", "csv", "--units", "mm", "--side", "front",
        "--use-drill-file-origin", "-o", tmp, PCB)
    fpmap = {p["ref"]: p for p in design.parts}
    cpl = os.path.join(OUT, "e220_lora_cpl_jlcpcb.csv")
    n = 0
    with open(tmp) as fi, open(cpl, "w", newline="") as fo:
        w = csv.writer(fo)
        w.writerow(["Designator", "Mid X", "Mid Y", "Layer", "Rotation"])
        for row in csv.DictReader(fi):
            ref = row["Ref"]
            p = fpmap.get(ref)
            if not p or not p["lcsc"] or ref in NOT_ASSEMBLED:
                continue
            rot = float(row["Rot"])
            for pat, off in ROT_FIX:
                if re.match(pat, p["fp"]):
                    rot = (rot + off) % 360
            w.writerow([ref, "%.4fmm" % float(row["PosX"]), "%.4fmm" % float(row["PosY"]),
                        "Top" if row["Side"] == "top" else "Bottom", "%g" % rot])
            n += 1
    os.remove(tmp)
    print("CPL:", os.path.relpath(cpl, ROOT), n, "placements")


if __name__ == "__main__":
    main()

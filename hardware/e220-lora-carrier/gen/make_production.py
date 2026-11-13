"""PCB-only production files for JLCPCB (gerbers + drill zip) and a shopping list.
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
PCB = os.path.join(ROOT, "e220_carrier.kicad_pcb")
OUT = os.path.join(ROOT, "production")
GERB = os.path.join(OUT, "gerber")
LAYERS = "F.Cu,B.Cu,F.SilkS,B.SilkS,F.Mask,B.Mask,Edge.Cuts"


def run(*a):
    subprocess.run(a, check=True, stdout=subprocess.DEVNULL)


def natkey(r):
    m = re.match(r"([A-Z]+)(\d+)", r)
    return (m.group(1), int(m.group(2)))


def main():
    os.makedirs(GERB, exist_ok=True)
    for f in os.listdir(GERB):
        os.remove(os.path.join(GERB, f))
    run("kicad-cli", "pcb", "export", "gerbers", "--layers", LAYERS, "--subtract-soldermask", "--no-x2",
        "--use-drill-file-origin", "-o", GERB + "/", PCB)
    run("kicad-cli", "pcb", "export", "drill", "--format", "excellon", "--drill-origin", "plot",
        "--excellon-units", "mm", "--excellon-zeros-format", "decimal", "-o", GERB + "/", PCB)
    z = os.path.join(OUT, "e220_carrier_gerber_jlcpcb.zip")
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(os.listdir(GERB)):
            zf.write(os.path.join(GERB, f), f)
    print("gerber zip:", os.path.relpath(z, ROOT))
    groups = {}
    for p in design.parts:
        if p["ref"].startswith("H"):
            continue
        groups.setdefault((p["buy"], p["value"]), []).append(p["ref"])
    path = os.path.join(OUT, "parts_list.csv")
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["部品", "値", "記号", "1台あたり個数"])
        for (buy, val), refs in sorted(groups.items(), key=lambda kv: natkey(sorted(kv[1], key=natkey)[0])):
            w.writerow([buy, val, " ".join(sorted(refs, key=natkey)), len(refs)])
        w.writerow(["ネジ・スペーサー M3", "", "H1-H4", 4])
    print("parts list:", os.path.relpath(path, ROOT))


if __name__ == "__main__":
    main()

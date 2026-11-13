"""Pseudo-realistic top/bottom renders (PNG) from per-layer KiCad SVGs.
Needs kicad-cli and node + playwright (pre-installed Chromium).
usage: python3 make_renders.py <scratch_dir>
"""
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
PCB = os.path.join(ROOT, "e220_carrier.kicad_pcb")

SIDES = {
    "top": [("F.Cu", "#2f7d3b"), ("F.Mask", "#d9b45b"), ("F.SilkS", "#f4f4f0"), ("Edge.Cuts", "#e8e8e8")],
    "bottom": [("B.Cu", "#2f7d3b"), ("B.Mask", "#d9b45b"), ("B.SilkS", "#f4f4f0"), ("Edge.Cuts", "#e8e8e8")],
}


def insets(mirror):
    import pcbnew
    import placement as pl
    b = pcbnew.LoadBoard(PCB)
    e, a = b.GetBoardEdgesBoundingBox(), b.ComputeBoundingBox(False)
    W, H = a.GetWidth(), a.GetHeight()
    l = (e.GetLeft() - a.GetLeft()) / W * 100
    r = (a.GetRight() - e.GetRight()) / W * 100
    t = (e.GetTop() - a.GetTop()) / H * 100
    bt = (a.GetBottom() - e.GetBottom()) / H * 100
    if mirror:
        l, r = r, l
    rad = pl.CORNER_R / (pcbnew.ToMM(W)) * 900
    return f"{l:.3f},{t:.3f},{r:.3f},{bt:.3f},{rad:.1f}"


def main(tmp):
    os.makedirs(tmp, exist_ok=True)
    js = os.path.join(tmp, "stack.js")
    with open(js, "w") as fh:
        fh.write(r"""
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [out, wpx, insets, ...svgs] = process.argv.slice(2);
  const [il, it, ir, ib, rad] = insets.split(',').map(Number);
  let layers = svgs.map(f => fs.readFileSync(f, 'utf8'))
    .map((s, i) => `<div class="l${i ? '' : ' base'}">${s}</div>`).join('');
  const html = `<html><head><style>
    body{margin:0;background:#ffffff}
    #c{position:relative;width:${wpx}px}
    .l{position:absolute;left:0;top:0;width:100%}
    .l.base{position:relative}
    svg{width:100%;height:auto;display:block}
    #board{position:absolute;left:${il}%;top:${it}%;right:${ir}%;bottom:${ib}%;background:#14532d;border-radius:${rad}px}
  </style></head><body><div id=c><div id=board></div>${layers}</div></body></html>`;
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:parseInt(wpx),height:400}, deviceScaleFactor:2});
  await page.setContent(html);
  await page.evaluate(() => document.querySelectorAll('svg').forEach(s => s.removeAttribute('height')));
  const bb = await (await page.$('#c')).boundingBox();
  await page.setViewportSize({width: parseInt(wpx), height: Math.ceil(bb.height)});
  const W = parseInt(wpx), Hh = Math.ceil(bb.height);
  await page.screenshot({path: out, omitBackground: true, timeout: 120000,
    clip: {x: W * il / 100, y: Hh * it / 100, width: W * (1 - (il + ir) / 100), height: Hh * (1 - (it + ib) / 100)}});
  await browser.close();
})();
""")
    for side, layers in SIDES.items():
        files = []
        for layer, color in layers:
            f = os.path.join(tmp, f"{side}_{layer}.svg")
            args = ["kicad-cli", "pcb", "export", "svg", "--layers", layer + ",Edge.Cuts", "--black-and-white",
                    "--exclude-drawing-sheet", "--page-size-mode", "2", "--drill-shape-opt", "2", "-o", f, PCB]
            if side == "bottom":
                args.insert(4, "--mirror")
            subprocess.run(args, check=True, stdout=subprocess.DEVNULL)
            s = open(f).read()
            s = re.sub(r"#000000", color, s, flags=re.I)
            # drill holes are drawn white in b/w mode -> make them dark
            s = re.sub(r"#FFFFFF", "#1b1b1b", s, flags=re.I)
            open(f, "w").write(s)
            files.append(f)
        out = os.path.join(ROOT, "docs", f"pcb_{side}.png")
        subprocess.run(["node", js, out, "900", insets(side == "bottom")] + files, check=True, cwd=tmp)
        print("render:", os.path.relpath(out, ROOT))


if __name__ == "__main__":
    main(sys.argv[1])

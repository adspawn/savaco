#!/usr/bin/env bash
# Regenerate everything from design.py / placement.py (needs KiCad 7 + numpy;
# renders also need node + playwright).
set -euo pipefail
cd "$(dirname "$0")"
python3 footprints.py
python3 make_sch.py
kicad-cli sch export netlist -o /tmp/e220_lora.net ../e220_lora.kicad_sch >/dev/null
python3 check_netlist.py /tmp/e220_lora.net
kicad-cli sch export pdf -o ../docs/schematic.pdf ../e220_lora.kicad_sch >/dev/null
python3 check_place.py
python3 make_pcb.py place
python3 router.py 20          # retries until every net is routed
python3 make_pcb.py finish    # GND pours, stitching vias, DRC -> docs/drc_report.txt
python3 make_production.py    # gerber zip, BOM, CPL for JLCPCB

#!/usr/bin/env bash
# Regenerate everything from design.py / placement.py (KiCad 7 + numpy;
# renders need node + playwright).
set -euo pipefail
cd "$(dirname "$0")"
python3 footprints.py
python3 make_sch.py
kicad-cli sch export netlist -o /tmp/e220_carrier.net ../e220_carrier.kicad_sch >/dev/null
python3 check_netlist.py /tmp/e220_carrier.net
kicad-cli sch export pdf -o ../docs/schematic.pdf ../e220_carrier.kicad_sch >/dev/null
python3 check_place.py
python3 make_pcb.py place
python3 router.py 20
python3 make_pcb.py finish      # GND pours + DRC -> docs/drc_report.txt
python3 make_production.py      # gerber zip + parts list

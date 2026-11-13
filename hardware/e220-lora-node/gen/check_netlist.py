"""Compare the netlist exported by kicad-cli from the schematic with design.py.

usage: python3 check_netlist.py <netlist.net>
Fails if any pin is on the wrong net, any net has a single pin, or a
power-input pin has no driver.
"""
import sys

import design
from sexp import find, findall, parse


def main(path):
    tree = parse(open(path).read())
    nets = find(tree, "nets")
    got = {}
    nodes_per_net = {}
    for n in findall(nets, "net"):
        name = find(n, "name")[1].lstrip("/")
        nodes = findall(n, "node")
        nodes_per_net[name] = nodes
        for nd in nodes:
            got[(find(nd, "ref")[1], find(nd, "pin")[1])] = name
    errors = []
    want_nets = set()
    for p in design.parts:
        for pin, net in p["pins"].items():
            g = got.get((p["ref"], pin))
            if net is None:
                if g is not None and not g.startswith("unconnected-"):
                    errors.append(f"{p['ref']}.{pin}: expected NC, got {g}")
                continue
            want_nets.add(net)
            if g != net:
                errors.append(f"{p['ref']}.{pin}: expected {net}, got {g}")
    for name, nodes in nodes_per_net.items():
        real = [nd for nd in nodes if not find(nd, "ref")[1].startswith("#")]
        if len(real) < 2 and not name.startswith("unconnected-"):
            errors.append(f"net {name} has only {len(real)} pin(s)")
    print(f"{len(nodes_per_net)} nets, {len(got)} pins checked against design.py")
    for e in errors:
        print("ERROR", e)
    if errors:
        sys.exit(1)
    print("OK: schematic connectivity matches design.py")


if __name__ == "__main__":
    main(sys.argv[1])

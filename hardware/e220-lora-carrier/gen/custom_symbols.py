"""Box symbols for the plug-in modules."""
from symbols import box_symbol

PI, PO, BI, IN, OUT, PAS = "power_in", "power_out", "bidirectional", "input", "output", "passive"


def supermini():
    return box_symbol(
        "e220_carrier:ESP32-C3_SuperMini", "A", "ESP32-C3 SuperMini",
        left=[("1", "5V", PAS), ("3", "3V3", PO), None, ("8", "IO0", BI), ("7", "IO1", BI),
              ("6", "IO2 (strap)", BI), ("5", "IO3", BI), ("4", "IO4", BI)],
        right=[("9", "IO5", BI), ("10", "IO6", BI), ("11", "IO7", BI), ("12", "IO8 (LED/SDA)", BI),
               ("13", "IO9 (BOOT/SCL)", BI), ("14", "IO10", BI), ("15", "IO20/RX0", BI), ("16", "IO21/TX0", BI)],
        bottom=[("2", "GND", PAS)], width=27.94,
        footprint="e220_carrier:ESP32-C3_SuperMini_Socket",
        datasheet="https://dl.artronshop.co.th/ESP32-C3%20SuperMini%20datasheet.pdf",
        description="ESP32-C3 SuperMini dev board (USB-C), plugged into 2x 1x8 sockets")


def e220_ev2():
    return box_symbol(
        "e220_carrier:E220-900T22S_JP-EV2", "A", "E220-900T22S(JP)-EV2",
        left=[("6", "VCC", PI), None, ("1", "M0", IN), ("2", "M1", IN), ("3", "RXD", IN),
              ("4", "TXD", OUT), ("5", "AUX", OUT)],
        right=[], bottom=[("7", "GND", PI)], width=20.32,
        footprint="e220_carrier:E220-EV2_Socket",
        datasheet="https://dragon-torch.tech/rf-modules/lora/e220-900t22s-jp-ev2/",
        description="E220-900T22S(JP) LoRa evaluation board with SMA, 1x7 header")


def mt3608():
    return box_symbol(
        "e220_carrier:MT3608_Module", "A", "MT3608 module",
        left=[("1", "IN+", PI), ("2", "IN-", PI)], right=[("3", "OUT+", PO), ("4", "OUT-", PAS)],
        width=15.24, footprint="e220_carrier:MT3608_Module_Wired",
        description="MT3608 boost module, trimmer set to 24 V")


ALL = {"e220_carrier:ESP32-C3_SuperMini": supermini,
       "e220_carrier:E220-900T22S_JP-EV2": e220_ev2,
       "e220_carrier:MT3608_Module": mt3608}

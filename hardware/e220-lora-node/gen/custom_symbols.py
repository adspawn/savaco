"""Box symbols for parts missing from the KiCad 7 stock library."""
from symbols import box_symbol

PI, PO, BI, IN, OUT, PAS, NCT = "power_in", "power_out", "bidirectional", "input", "output", "passive", "no_connect"


def esp32c3():
    return box_symbol(
        "e220_lora:ESP32-C3-WROOM-02", "U", "ESP32-C3-WROOM-02",
        left=[("1", "3V3", PI), ("2", "EN", IN), None,
              ("18", "IO0/ADC1_0", BI), ("17", "IO1/ADC1_1", BI), ("16", "IO2 (strap)", BI),
              ("15", "IO3/ADC1_3", BI), ("3", "IO4", BI), ("4", "IO5", BI)],
        right=[("5", "IO6", BI), ("6", "IO7", BI), ("7", "IO8 (strap)", BI), ("8", "IO9/BOOT", BI),
               ("10", "IO10", BI), ("13", "IO18/USB_D-", BI), ("14", "IO19/USB_D+", BI),
               ("11", "IO20/U0RXD", BI), ("12", "IO21/U0TXD", BI)],
        bottom=[(["9", "19"], "GND", PI)],
        width=25.4, footprint="RF_Module:ESP32-C3-WROOM-02",
        datasheet="https://www.espressif.com/sites/default/files/documentation/esp32-c3-wroom-02_datasheet_en.pdf",
        description="ESP32-C3 Wi-Fi/BLE module, 4MB flash")


def e220():
    return box_symbol(
        "e220_lora:E220-900T22S_JP", "U", "E220-900T22S(JP)",
        left=[("10", "VCC", PI), ("15", "VDD", PAS), None, ("5", "M0", IN), ("6", "M1", IN),
              ("7", "RXD", IN), ("8", "TXD", OUT), ("9", "AUX", OUT)],
        right=[("21", "ANT", PAS), None, ("12", "SWDIO", BI), ("14", "SWCLK", IN),
               ("16", "NC", NCT), ("17", "NC", NCT), ("18", "NC", NCT)],
        bottom=[(["4", "1", "2", "3", "11", "13", "19", "20", "22"], "GND", PI)],
        width=20.32, footprint="e220_lora:E220-900T22S_JP",
        datasheet="https://dragon-torch.tech/wp-content/uploads/2024/11/DS241011JA_E220-900T22Sv1_Rev2.1.2.pdf",
        description="CLEALINK E220-900T22S(JP) 920MHz LoRa UART module")


def tp4056():
    return box_symbol(
        "e220_lora:TP4056", "U", "TP4056",
        left=[("4", "VCC", PI), ("8", "CE", IN), ("1", "TEMP", IN), ("2", "PROG", PAS)],
        right=[("5", "BAT", PAS), ("7", "~{CHRG}", OUT), ("6", "~{STDBY}", OUT)],
        bottom=[(["3", "9"], "GND", PI)],
        width=15.24, footprint="e220_lora:ESOP-8_TP4056",
        datasheet="https://www.lcsc.com/datasheet/lcsc_datasheet_1809261820_TOPPOWER-Nanjing-Extension-Microelectronics-TP4056-42-ESOP8_C16581.pdf",
        description="1A standalone linear Li-ion charger")


ALL = {"e220_lora:ESP32-C3-WROOM-02": esp32c3,
       "e220_lora:E220-900T22S_JP": e220,
       "e220_lora:TP4056": tp4056}

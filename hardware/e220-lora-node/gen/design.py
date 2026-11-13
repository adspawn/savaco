"""Single source of truth for the E220 LoRa node: parts, LCSC numbers, nets,
and schematic placement. make_sch.py / make_pcb.py / make_bom.py read this.

ESP32-C3 GPIO map
  IO0  BAT_ADC     ADC1_CH0, VSW/2 divider
  IO1  BTN_IO      main button (onboard + external), deep-sleep wake capable
  IO2  LORA_M1     strapping pin -> 10k pull-up (M1 also has internal pull-up)
  IO3  LORA_AUX    E220 AUX (wake capable)
  IO4  LORA_M0
  IO5  LORA_TXD    E220 TXD -> ESP RX (UART1)
  IO6  LED_G
  IO7  BUZ         onboard magnetic buzzer (PWM, ~2.7 kHz)
  IO8  LORA_RXD    ESP TX (UART1) -> E220 RXD, strapping -> 10k pull-up
  IO9  BOOT        BOOT button, strapping -> 10k pull-up
  IO10 SIREN_EN    MT3608 enable (12 V boost on/off), 100k pull-down
  IO18 USB_DN      native USB (programming / serial)
  IO19 USB_DP
  IO20 SIREN_PWM   external 12 V siren low-side switch, 100k pull-down
                   (U0RXD at boot = input, so the siren stays silent)
  IO21 LED_R       U0TXD: flickers with the boot log, harmless on an LED
"""

NC = None  # no-connect marker

# Footprints
R0603 = "Resistor_SMD:R_0603_1608Metric"
C0603 = "Capacitor_SMD:C_0603_1608Metric"
C0805 = "Capacitor_SMD:C_0805_2012Metric"
C1206 = "Capacitor_SMD:C_1206_3216Metric"
LED0603 = "LED_SMD:LED_0603_1608Metric"
SOT23 = "Package_TO_SOT_SMD:SOT-23"
SOT235 = "Package_TO_SOT_SMD:SOT-23-5"
SOT236 = "Package_TO_SOT_SMD:SOT-23-6"
XH2 = "Connector_JST:JST_XH_B2B-XH-A_1x02_P2.50mm_Vertical"

# LCSC part numbers (all checked in stock on JLCPCB, see docs/BOM)
LCSC = {
    "10k": "C25804", "5.1k": "C23186", "100k": "C25803", "1k": "C21190", "2k": "C22975",
    "200k": "C25811", "470": "C23179", "100": "C22775",
    "100nF": "C14663", "1uF": "C15849", "10uF_0805": "C15850", "10uF_0603": "C19702",
    "22uF_1206": "C12891",
}

parts = []


def part(ref, sym, value, fp, lcsc, pins, sch, desc="", dnp=False, vpos=None):
    parts.append(dict(ref=ref, sym=sym, value=value, fp=fp, lcsc=lcsc, pins=pins,
                      sch=sch, desc=desc, dnp=dnp, vpos=vpos))


def R(ref, value, a, b, sch):
    part(ref, "Device:R", value if value.endswith(("k", "M")) else value + "Ω" if value[-1].isdigit() else value,
         R0603, LCSC[value], {"1": a, "2": b}, sch + (90,))


def C(ref, value, a, b, sch, size="0603"):
    key = value if value in LCSC else f"{value}_{size}"
    fp = {"0603": C0603, "0805": C0805, "1206": C1206}[size]
    part(ref, "Device:C", value, fp, LCSC[key], {"1": a, "2": b}, sch + (90,))


def LED(ref, color, lcsc, anode, cathode, sch):
    part(ref, "Device:LED", color, LED0603, lcsc, {"2": anode, "1": cathode}, sch + (180,))


# ----------------------------------------------------------------------------
# Block 1: USB-C input + ESD                              (schematic x 20..95)
# ----------------------------------------------------------------------------
part("J1", "Connector:USB_C_Receptacle_USB2.0_16P", "USB-C (TYPE-C-31-M-12)",
     "Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12", "C165948",
     {"A1": "GND", "A12": "GND", "B1": "GND", "B12": "GND",
      "A4": "VBUS", "A9": "VBUS", "B4": "VBUS", "B9": "VBUS",
      "A5": "CC1", "B5": "CC2", "A6": "USB_DP", "B6": "USB_DP", "A7": "USB_DN", "B7": "USB_DN",
      "A8": NC, "B8": NC, "S1": "GND"}, (45.72, 71.12, 0), "USB-C power + native USB")
R("R1", "5.1k", "CC1", "GND", (78.74, 50.8))
R("R2", "5.1k", "CC2", "GND", (78.74, 58.42))
part("U1", "Power_Protection:USBLC6-2SC6", "USBLC6-2SC6", SOT236, "C7519",
     {"1": "USB_DP", "6": "USB_DP", "3": "USB_DN", "4": "USB_DN", "2": "GND", "5": "VBUS"},
     (78.74, 88.9, 0), "USB ESD protection")

# ----------------------------------------------------------------------------
# Block 2: Li-ion charger                                (schematic x 110..190)
# ----------------------------------------------------------------------------
part("U2", "e220_lora:TP4056", "TP4056", "e220_lora:ESOP-8_TP4056", "C16581",
     {"1": "GND", "2": "CHG_PROG", "3": "GND", "4": "VBUS", "5": "VBAT", "6": "STDBY_N",
      "7": "CHRG_N", "8": "VBUS", "9": "GND"}, (139.7, 63.5, 0), "1S Li-ion charger, ~580 mA")
C("C1", "10uF", "VBUS", "GND", (114.3, 86.36), "0805")
R("R3", "2k", "CHG_PROG", "GND", (114.3, 93.98))
C("C2", "10uF", "VBAT", "GND", (165.1, 86.36), "0805")
R("R4", "1k", "VBUS", "LEDC_A", (114.3, 101.6))
LED("LED3", "RED (CHG)", "C2286", "LEDC_A", "CHRG_N", (132.08, 101.6))
R("R5", "1k", "VBUS", "LEDS_A", (114.3, 109.22))
LED("LED4", "GREEN (FULL)", "C12624", "LEDS_A", "STDBY_N", (132.08, 109.22))
part("J2", "Connector_Generic:Conn_01x02", "BATTERY 1S LiPo (JST PH)",
     "Connector_JST:JST_PH_S2B-PH-K_1x02_P2.00mm_Horizontal", "C173752",
     {"1": "VBAT", "2": "GND"}, (175.26, 104.14, 0), "battery: pin1 = +")

# ----------------------------------------------------------------------------
# Block 3: power path, switch, 3.3 V LDO, battery sense  (schematic x 205..300)
# ----------------------------------------------------------------------------
part("D1", "Diode:SS34", "SS34", "Diode_SMD:D_SMA", "C8678", {"2": "VBUS", "1": "VSYS"},
     (218.44, 50.8, 180), "USB -> system")
part("Q1", "Transistor_FET:AO3401A", "AO3401A", SOT23, "C15127",
     {"1": "VBUS", "2": "VSYS", "3": "VBAT"}, (218.44, 66.04, 0), "battery -> system (load sharing)")
R("R6", "100k", "VBUS", "GND", (208.28, 83.82))
C("C3", "10uF", "VSYS", "GND", (231.14, 83.82), "0805")
part("SW1", "Switch:SW_SPDT", "POWER (MSK12C02)", "e220_lora:SW_MSK12C02", "C431541",
     {"2": "VSYS", "1": "VSW", "3": NC}, (248.92, 55.88, 0), "main power switch")
part("U3", "Regulator_Linear:AP2112K-3.3", "AP2112K-3.3", SOT235, "C51118",
     {"1": "VSW", "3": "VSW", "2": "GND", "4": NC, "5": "+3V3"}, (276.86, 60.96, 0), "3.3 V 600 mA LDO")
C("C4", "10uF", "VSW", "GND", (264.16, 83.82), "0805")
C("C5", "10uF", "+3V3", "GND", (289.56, 83.82), "0603")
R("R7", "100k", "VSW", "BAT_ADC", (264.16, 99.06))
R("R8", "100k", "BAT_ADC", "GND", (289.56, 99.06))
C("C6", "100nF", "BAT_ADC", "GND", (289.56, 106.68))

# ----------------------------------------------------------------------------
# Block 4: ESP32-C3                                      (schematic x 20..150)
# ----------------------------------------------------------------------------
part("U4", "e220_lora:ESP32-C3-WROOM-02", "ESP32-C3-WROOM-02-N4", "RF_Module:ESP32-C3-WROOM-02", "C2934560",
     {"1": "+3V3", "2": "EN", "3": "LORA_M0", "4": "LORA_TXD", "5": "LED_G", "6": "BUZ",
      "7": "LORA_RXD", "8": "BOOT", "9": "GND", "10": "SIREN_EN", "11": "SIREN_PWM",
      "12": "LED_R", "13": "USB_DN", "14": "USB_DP", "15": "LORA_AUX", "16": "LORA_M1",
      "17": "BTN_IO", "18": "BAT_ADC", "19": "GND"}, (60.96, 165.1, 0), "MCU (Wi-Fi/BLE, native USB)")
C("C7", "10uF", "+3V3", "GND", (106.68, 137.16), "0603")
C("C8", "100nF", "+3V3", "GND", (106.68, 144.78))
R("R9", "10k", "+3V3", "EN", (106.68, 152.4))
C("C9", "1uF", "EN", "GND", (106.68, 160.02))
part("SW2", "Switch:SW_Push", "RESET", "e220_lora:SW_TS-1187A", "C318884", {"1": "EN", "2": "GND"},
     (127.0, 160.02, 0))
R("R10", "10k", "+3V3", "BOOT", (106.68, 170.18))
part("SW3", "Switch:SW_Push", "BOOT", "e220_lora:SW_TS-1187A", "C318884", {"1": "BOOT", "2": "GND"},
     (127.0, 170.18, 0))
R("R11", "10k", "+3V3", "LORA_RXD", (106.68, 180.34))
R("R12", "10k", "+3V3", "LORA_M1", (106.68, 187.96))

# ----------------------------------------------------------------------------
# Block 5: E220-900T22S(JP) LoRa                        (schematic x 165..300)
# ----------------------------------------------------------------------------
part("U5", "e220_lora:E220-900T22S_JP", "E220-900T22S(JP)", "e220_lora:E220-900T22S_JP", "",
     {"1": "GND", "2": "GND", "3": "GND", "4": "GND", "5": "LORA_M0", "6": "LORA_M1",
      "7": "LORA_RXD", "8": "LORA_TXD", "9": "LORA_AUX", "10": "VSW", "11": "GND",
      "12": NC, "13": "GND", "14": NC, "15": NC, "16": NC, "17": NC, "18": NC,
      "19": "GND", "20": "GND", "21": "ANT", "22": "GND"}, (210.82, 167.64, 0),
     "920 MHz LoRa (hand-solder / consigned, not in LCSC)")
C("C10", "10uF", "VSW", "GND", (254.0, 142.24), "0805")
C("C11", "100nF", "VSW", "GND", (254.0, 149.86))
C("C12", "100nF", "LORA_AUX", "GND", (254.0, 157.48))
part("J3", "Connector:Conn_Coaxial", "SMA (BWSMA-KE-Z001)", "e220_lora:SMA_BWSMA-KE-Z001", "C496549",
     {"1": "ANT", "2": "GND"}, (271.78, 175.26, 0), "antenna (or use the module IPEX)", vpos=(3.81, 5.08))

# ----------------------------------------------------------------------------
# Block 6: button + LEDs                                 (schematic x 20..120)
# ----------------------------------------------------------------------------
part("SW4", "Switch:SW_Push", "BUTTON", "e220_lora:SW_TS-1187A", "C318884", {"1": "BTN", "2": "GND"},
     (35.56, 238.76, 0), "onboard main button")
part("J4", "Connector_Generic:Conn_01x02", "EXT BUTTON (XH)", XH2, "C158012",
     {"1": "BTN", "2": "GND"}, (35.56, 254.0, 180), "external arcade button, parallel to SW4")
R("R13", "10k", "+3V3", "BTN", (60.96, 231.14))
C("C13", "100nF", "BTN", "GND", (60.96, 238.76))
R("R14", "1k", "BTN", "BTN_IO", (60.96, 246.38))
R("R15", "100", "LED_G", "LED_G_A", (86.36, 231.14))
LED("LED1", "GREEN", "C12624", "LED_G_A", "GND", (104.14, 231.14))
R("R16", "470", "LED_R", "LED_R_A", (86.36, 241.3))
LED("LED2", "RED", "C2286", "LED_R_A", "GND", (104.14, 241.3))

# ----------------------------------------------------------------------------
# Block 7: onboard buzzer                               (schematic x 135..195)
# ----------------------------------------------------------------------------
part("BZ1", "Device:Buzzer", "MLT-8530 (80dB)", "e220_lora:Buzzer_MLT-8530", "C94599",
     {"1": "VSW", "2": "BUZ_N"}, (162.56, 233.68, 0), "magnetic transducer, drive 2.7 kHz PWM", vpos=(5.08, 3.81))
part("D2", "Device:D", "1N4148W", "Diode_SMD:D_SOD-123", "C81598", {"2": "BUZ_N", "1": "VSW"},
     (180.34, 228.6, 180))
part("Q2", "Transistor_FET:AO3400A", "AO3400A", SOT23, "C20917",
     {"1": "BUZ", "2": "GND", "3": "BUZ_N"}, (162.56, 251.46, 0))
R("R17", "100k", "BUZ", "GND", (142.24, 261.62))

# ----------------------------------------------------------------------------
# Block 8: 12 V boost + external siren                  (schematic x 210..330)
# ----------------------------------------------------------------------------
part("U6", "Regulator_Switching:MT3608", "MT3608", SOT236, "C84817",
     {"1": "MT_SW", "2": "GND", "3": "MT_FB", "4": "SIREN_EN", "5": "VSW", "6": NC},
     (243.84, 236.22, 0), "boost to ~12.6 V for the external siren")
part("L1", "Device:L", "10uH 1.5A", "Inductor_SMD:L_Sunlord_SWPA4030S", "C38117",
     {"1": "VSW", "2": "MT_SW"}, (213.36, 223.52, 90))
part("D3", "Diode:SS34", "SS34", "Diode_SMD:D_SMA", "C8678", {"2": "MT_SW", "1": "V12"},
     (269.24, 223.52, 180))
C("C14", "10uF", "VSW", "GND", (213.36, 231.14), "0805")
C("C15", "22uF", "V12", "GND", (269.24, 231.14), "1206")
R("R18", "200k", "V12", "MT_FB", (269.24, 238.76))
R("R19", "10k", "MT_FB", "GND", (269.24, 246.38))
R("R20", "100k", "SIREN_EN", "GND", (213.36, 238.76))
part("Q3", "Transistor_FET:AO3400A", "AO3400A", SOT23, "C20917",
     {"1": "SIREN_PWM", "2": "GND", "3": "SIREN_N"}, (325.12, 238.76, 0))
R("R21", "100k", "SIREN_PWM", "GND", (299.72, 246.38))
part("D4", "Device:D", "1N4148W", "Diode_SMD:D_SOD-123", "C81598", {"2": "SIREN_N", "1": "V12"},
     (350.52, 223.52, 180))
part("J5", "Connector_Generic:Conn_01x02", "SIREN 12V (XH)", XH2, "C158012",
     {"1": "V12", "2": "SIREN_N"}, (325.12, 223.52, 0), "external 12 V piezo siren (100 dB class)")

# Mounting holes
for i, ref in enumerate(["H1", "H2", "H3", "H4"]):
    part(ref, "Mechanical:MountingHole", "M3", "MountingHole:MountingHole_3.2mm_M3", "", {},
         (322.58 + 10.16 * i, 195.58, 0))

# Power flags (schematic only)
POWER_FLAGS = [("VBUS", (30.48, 30.48)), ("GND", (45.72, 30.48)), ("VSW", (60.96, 30.48)),
               ("VBAT", (76.2, 30.48)), ("VSYS", (91.44, 30.48))]

BLOCKS = [
    ("1. USB-C 入力 / ESD保護", (17.78, 35.56, 99.06, 101.6)),
    ("2. Li-ion 充電 (TP4056, 約580mA)", (104.14, 35.56, 190.5, 119.38)),
    ("3. 電源パス / 電源SW / 3.3V LDO / 電池電圧監視", (195.58, 35.56, 304.8, 119.38)),
    ("4. ESP32-C3 (WROOM-02)", (17.78, 124.46, 139.7, 205.74)),
    ("5. LoRa E220-900T22S(JP) 920MHz", (147.32, 124.46, 304.8, 205.74)),
    ("6. ボタン / LED", (17.78, 213.36, 124.46, 276.86)),
    ("7. 基板ブザー (MLT-8530, 80dB)", (129.54, 213.36, 195.58, 276.86)),
    ("8. 12V昇圧 + 外付けサイレン (100dB級)", (200.66, 213.36, 368.3, 250.19)),
]

NOTES = [
    "E220-900T22S(JP): LCSC取扱いなし → JLCPCBでは未実装(DNP)。手はんだ、またはJLCPCB委託部品として供給。",
    "E220 VCC(10)はVSW(3.0〜4.7V)から給電。VDD(15)は未接続(内部LDO出力)。AUXに100nF(データシート推奨)。",
    "J3 SMAは任意。モジュールのIPEXコネクタ+ピグテールでも可。ANTとIPEXを同時に使わないこと。",
    "外付けサイレンはSIREN_EN=H(昇圧ON)の後にSIREN_PWM=Hで鳴動。待機時は両方Lで昇圧停止。",
    "J2電池コネクタの極性はバッテリーにより逆の製品があるので必ず確認 (pin1=+)。保護回路付きLiPoを使用。",
]

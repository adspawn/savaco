"""E220 LoRa carrier board (all through-hole, modules plug in).

ESP32-C3 SuperMini GPIO map
  IO0  BTN_IO     button (onboard 12 mm + external), 10k pull-up
  IO1  BUZ        onboard 5 V active buzzer via 2SC1815
  IO2  -          strapping pin, left free
  IO3  SIREN      24 V siren via TIP120 (100k pull-down: silent at boot)
  IO4  LED_G
  IO5  LORA_RXD   ESP TX (UART1) -> E220 RXD
  IO6  LORA_TXD   E220 TXD -> ESP RX (UART1)
  IO7  LORA_AUX
  IO8  I2C_SDA    (onboard blue LED, strapping) -> I2C header for an OLED etc.
  IO9  I2C_SCL    (BOOT button, strapping)
  IO10 LORA_M0
  IO20 LORA_M1
  IO21 LED_R      U0TXD: flickers during boot log, harmless
Power: mobile battery -> SuperMini USB-C -> 5V pin -> E220 VCC, buzzer, MT3608.
"""
NC = None

R_TH = "Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal"
D_TH = "Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal"
CP_TH = "Capacitor_THT:CP_Radial_D6.3mm_P2.50mm"
C_TH = "Capacitor_THT:C_Disc_D5.0mm_W2.5mm_P5.00mm"
XH2 = "Connector_JST:JST_XH_B2B-XH-A_1x02_P2.50mm_Vertical"

parts = []


def part(ref, sym, value, fp, pins, sch, buy="", vpos=None):
    parts.append(dict(ref=ref, sym=sym, value=value, fp=fp, lcsc="", pins=pins, sch=sch,
                      buy=buy, dnp=False, vpos=vpos))


def R(ref, value, a, b, sch):
    part(ref, "Device:R", value, R_TH, {"1": a, "2": b}, sch + (90,), "カーボン抵抗 1/4W")


# ---- 1. modules ----------------------------------------------------------------
part("A1", "e220_carrier:ESP32-C3_SuperMini", "ESP32-C3 SuperMini", "e220_carrier:ESP32-C3_SuperMini_Socket",
     {"1": "+5V", "2": "GND", "3": "+3V3", "4": "LED_G", "5": "SIREN", "6": NC, "7": "BUZ", "8": "BTN_IO",
      "9": "LORA_RXD", "10": "LORA_TXD", "11": "LORA_AUX", "12": "I2C_SDA", "13": "I2C_SCL",
      "14": "LORA_M0", "15": "LORA_M1", "16": "LED_R"}, (63.5, 76.2, 0),
     "ESP32-C3 SuperMini（ピンヘッダ付き）＋ 1x8ピンソケット×2")
part("A2", "e220_carrier:E220-900T22S_JP-EV2", "E220-900T22S(JP)-EV2", "e220_carrier:E220-EV2_Socket",
     {"1": "LORA_M0", "2": "LORA_M1", "3": "LORA_RXD", "4": "LORA_TXD", "5": "LORA_AUX", "6": "+5V",
      "7": "GND"}, (152.4, 76.2, 0), "E220-900T22S(JP)-EV2 ＋ 1x7ピンソケット")
part("C1", "Device:C_Polarized", "100uF 16V", CP_TH, {"1": "+5V", "2": "GND"}, (106.68, 101.6, 0),
     "電解コンデンサ 100uF 16V以上")
part("C2", "Device:C", "0.1uF", C_TH, {"1": "+5V", "2": "GND"}, (129.54, 101.6, 0), "積層セラミック 0.1uF")
part("J3", "Connector_Generic:Conn_01x04", "I2C (OLED)", "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical",
     {"1": "GND", "2": "+3V3", "3": "I2C_SCL", "4": "I2C_SDA"}, (106.68, 66.04, 0), "ピンヘッダ 1x4（任意）")

# ---- 2. button + LEDs ------------------------------------------------------------
part("SW1", "Switch:SW_Push", "BUTTON 12mm", "Button_Switch_THT:SW_PUSH-12mm", {"1": "BTN", "2": "GND"},
     (35.56, 147.32, 0), "タクトスイッチ 12mm")
part("J1", "Connector_Generic:Conn_01x02", "EXT BUTTON (XH)", XH2, {"1": "BTN", "2": "GND"}, (35.56, 162.56, 180),
     "XHコネクタ 2P（外付けボタン用、任意）")
R("R3", "10k", "+3V3", "BTN", (58.42, 139.7))
part("C3", "Device:C", "0.1uF", C_TH, {"1": "BTN", "2": "GND"}, (58.42, 149.86, 90), "積層セラミック 0.1uF")
R("R4", "1k", "BTN", "BTN_IO", (58.42, 160.02))
R("R5", "220", "LED_G", "LED_G_A", (86.36, 139.7))
part("LED1", "Device:LED", "GREEN 5mm", "LED_THT:LED_D5.0mm", {"2": "LED_G_A", "1": "GND"}, (104.14, 139.7, 180),
     "LED 5mm 緑")
R("R6", "220", "LED_R", "LED_R_A", (86.36, 152.4))
part("LED2", "Device:LED", "RED 5mm", "LED_THT:LED_D5.0mm", {"2": "LED_R_A", "1": "GND"}, (104.14, 152.4, 180),
     "LED 5mm 赤")

# ---- 3. onboard buzzer ---------------------------------------------------------------
part("BZ1", "Device:Buzzer", "5V active buzzer 12mm (85dB)", "Buzzer_Beeper:Buzzer_12x9.5RM7.6",
     {"1": "+5V", "2": "BUZ_N"}, (147.32, 139.7, 0), "電子ブザー（自励式）5V 12mm ピッチ7.6mm", vpos=(5.08, 3.81))
part("D1", "Diode:1N4148", "1N4148", D_TH, {"2": "BUZ_N", "1": "+5V"}, (167.64, 134.62, 180), "1N4148")
part("Q1", "Transistor_BJT:2SC1815", "2SC1815", "Package_TO_SOT_THT:TO-92_Inline_Wide",
     {"1": "GND", "2": "BUZ_N", "3": "BUZ_B"}, (147.32, 160.02, 0), "2SC1815 (GR) または同等品")
R("R1", "1k", "BUZ", "BUZ_B", (127.0, 160.02))
R("R7", "100k", "BUZ", "GND", (127.0, 170.18))

# ---- 4. 24 V siren -----------------------------------------------------------------------
part("A3", "e220_carrier:MT3608_Module", "MT3608 module -> 24V", "e220_carrier:MT3608_Module_Wired",
     {"1": "+5V", "2": "GND", "3": "+24V", "4": "GND"}, (218.44, 139.7, 0),
     "MT3608 昇圧モジュール（半固定抵抗で24Vに調整）")
part("C4", "Device:C_Polarized", "47uF 35V", CP_TH, {"1": "+24V", "2": "GND"}, (248.92, 149.86, 0),
     "電解コンデンサ 47uF 35V以上")
part("J2", "Connector_Generic:Conn_01x02", "SIREN 24V (XH)", XH2, {"1": "+24V", "2": "SIREN_N"},
     (269.24, 139.7, 0), "XHコネクタ 2P（サイレン用）")
part("D2", "Diode:1N4148", "1N4148", D_TH, {"2": "SIREN_N", "1": "+24V"}, (289.56, 134.62, 180), "1N4148")
part("Q2", "Transistor_BJT:TIP120", "TIP120", "Package_TO_SOT_THT:TO-220-3_Vertical",
     {"1": "SIREN_B", "2": "SIREN_N", "3": "GND"}, (269.24, 160.02, 0), "TIP120（ダーリントン 60V 5A）")
R("R2", "1k", "SIREN", "SIREN_B", (246.38, 160.02))
R("R8", "100k", "SIREN", "GND", (246.38, 170.18))

for i, ref in enumerate(["H1", "H2", "H3", "H4"]):
    part(ref, "Mechanical:MountingHole", "M3", "MountingHole:MountingHole_3.2mm_M3", {}, (322.58 + 10.16 * i, 195.58, 0))

POWER_FLAGS = [("+5V", (30.48, 30.48)), ("GND", (45.72, 30.48))]

BLOCKS = [
    ("1. モジュール（ESP32-C3 SuperMini / E220-EV2、ソケット差し込み）", (17.78, 35.56, 200.66, 119.38)),
    ("2. ボタン / LED", (17.78, 124.46, 124.46, 182.88)),
    ("3. 基板ブザー（5V 電子ブザー 85dB）", (124.46, 124.46, 195.58, 182.88)),
    ("4. 24V昇圧（MT3608モジュール）＋ 外付けサイレン", (200.66, 124.46, 304.8, 182.88)),
]

NOTES = [
    "給電はモバイルバッテリー→SuperMiniのUSB-C。5V端子からE220(VCC)、ブザー、昇圧モジュールへ供給。",
    "MT3608モジュールは配線でIN/OUTパッドに接続し、両面テープで固定。半固定抵抗を24Vに合わせてから接続。",
    "サイレンは DC24V 対応品を使用（12V専用品は不可）。IO3=Hで鳴動、起動中は100kでOFF。",
    "E220のM0/M1は内部プルアップ。起動直後は設定モード(1/1)、ファームで0/0にして通常モード。",
    "IO8/IO9はSuperMini上のLED/BOOTと共用。I2C(OLED等)用にJ3へ出しています。",
]

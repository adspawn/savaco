// ============================================
// ボタン押下時間 -> 文字列 -> UNIT-C6L (Serial Module TEXTMSG) -> LoRa の試験
//
//   0.8秒以内に離す   : "SHORT:A#<連番>"
//   10秒保持した瞬間  : "LONG:A#<連番>"   (離すのを待たず即送信)
//   0.8〜10秒で離す   : "CANCEL:A:<秒>#<連番>"  (例 CANCEL:A:4.2#7)
//
// "#<連番>" は遅延計測用。本番では付けない。
// 送信した瞬間に USB シリアルへ "TX <連番>" を出す (latency_test.py が使う)。
//
// 配線 (ブレッドボード + ジャンパ):
//   ESP32 D4  (GPIO4)  -> UNIT-C6L G4   (ESP32 TX -> C6L rxd)
//   ESP32 D5  (GPIO5)  <- UNIT-C6L G5   (C6L txd -> ESP32 RX)
//   ESP32 D18 (GPIO18) -> ボタン片側 (もう片側は GND)。ジャンパ短絡でも可
//   GND同士も必ず共通に接続 (5V/3V3は接続しない)
// ============================================

const int UART_TX_PIN = 4;
const int UART_RX_PIN = 5;
const int BUTTON_PIN  = 18;                    // 内部プルアップ。GND短絡でLOW=押下
const unsigned long BAUD = 38400;              // C6L側 serial.baud (BAUD_DEFAULT) と一致
const unsigned long DEBOUNCE_MS   = 50;
const unsigned long SHORT_MAX_MS  = 800;       // これ以内に離したら短押し
const unsigned long HOLD_MS       = 10000;     // この時間保持で長押し確定

unsigned long seq = 0;
bool          pressed     = false;
bool          longFired   = false;
unsigned long pressStart  = 0;

bool          lastRaw     = HIGH;
bool          stable      = HIGH;
unsigned long rawChange   = 0;

void sendMsg(const String &msg) {
  seq++;
  Serial1.printf("%s#%lu\n", msg.c_str(), seq);   // TEXTMSGは改行で1メッセージ確定
  Serial.printf("TX %lu  (%s)\n", seq, msg.c_str());
}

void setup() {
  Serial.begin(115200);
  Serial1.begin(BAUD, SERIAL_8N1, UART_RX_PIN, UART_TX_PIN);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  delay(500);
  Serial.println("=== button_send_test ===");
  Serial.printf("UART TX=GPIO%d RX=GPIO%d %lubps / BUTTON=GPIO%d\n",
                UART_TX_PIN, UART_RX_PIN, BAUD, BUTTON_PIN);
}

void loop() {
  while (Serial1.available()) {                  // C6L -> PC へ転送 (デバッグ用)
    static String buf;
    char c = Serial1.read();
    if (c == '\n') { Serial.println("C6L> " + buf); buf = ""; }
    else if (c != '\r') buf += c;
  }

  // デバウンス
  bool raw = digitalRead(BUTTON_PIN);
  if (raw != lastRaw) { lastRaw = raw; rawChange = millis(); }
  if (raw != stable && millis() - rawChange > DEBOUNCE_MS) {
    stable = raw;
    if (stable == LOW) {                         // 押下
      pressed = true; longFired = false; pressStart = millis();
      Serial.println("押下");
    } else if (pressed) {                        // 離した
      pressed = false;
      unsigned long dur = millis() - pressStart;
      Serial.printf("離した (%.1f秒)\n", dur / 1000.0);
      if (!longFired) {
        if (dur <= SHORT_MAX_MS) sendMsg("SHORT:A");
        else                     sendMsg(String("CANCEL:A:") + String(dur / 1000.0, 1));
      }
    }
  }

  // 長押し確定 (離すのを待たず送る)
  if (pressed && !longFired && millis() - pressStart >= HOLD_MS) {
    longFired = true;
    sendMsg("LONG:A");
  }
}

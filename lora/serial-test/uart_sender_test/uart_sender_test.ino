// ============================================
// Serial Module 検証用: ESP32 (WROOM-32D / C3どちらも可) -> UNIT-C6L (UART, TEXTMSGモード)
//
// ボタン押下 (BOOTボタン=GPIO0) または一定間隔で "SHORT:A#<連番>\n" を
// UNIT-C6L の Grove 端子 (G4) へUARTで送る。
// 送信した瞬間に USB シリアルへ "TX <連番>" を出す (PC側の遅延計測用)。
// C6L の txd (G5) から出てくるもの (受信メッセージ等) は "C6L> " 付きで USB へ転送する。
//
// 配線 (ブレッドボード + ジャンパ):
//   ESP32 D4 (GPIO4) -> UNIT-C6L G4  (ESP32 TX -> C6L rxd)
//   ESP32 D5 (GPIO5) <- UNIT-C6L G5  (C6L txd -> ESP32 RX)
//   GND同士も必ず共通に接続 (5V/3V3は接続しない。電源は各自のUSB)
// ============================================

const int UART_TX_PIN = 4;      // C6L G4 へ
const int UART_RX_PIN = 5;      // C6L G5 から
const int BUTTON_PIN  = 0;      // DevKitのBOOTボタン (押すとLOW)
const unsigned long BAUD = 38400;    // C6L側 serial.baud (BAUD_DEFAULT=38400) と一致させる
const unsigned long AUTO_INTERVAL_MS = 10000;  // 0で自動送信なし (ボタンのみ)
const unsigned long DEBOUNCE_MS = 50;

unsigned long seq = 0;
unsigned long lastAuto = 0;
bool lastBtn = HIGH;
unsigned long btnChange = 0;

void sendOnce() {
  seq++;
  Serial1.printf("SHORT:A#%lu\n", seq);      // TEXTMSGは改行で1メッセージ確定
  Serial.printf("TX %lu\n", seq);            // PCがこの行の受信時刻を送信時刻とみなす
}

void setup() {
  Serial.begin(115200);
  Serial1.begin(BAUD, SERIAL_8N1, UART_RX_PIN, UART_TX_PIN);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  delay(500);
  Serial.println("=== uart_sender_test ===");
  Serial.printf("UART TX=GPIO%d RX=GPIO%d %lubps / auto=%lums\n", UART_TX_PIN, UART_RX_PIN, BAUD, AUTO_INTERVAL_MS);
  lastAuto = millis();
}

void loop() {
  while (Serial1.available()) {              // C6L -> PC へ転送 (デバッグ用)
    static String buf;
    char c = Serial1.read();
    if (c == '\n') { Serial.println("C6L> " + buf); buf = ""; }
    else if (c != '\r') buf += c;
  }
  bool btn = digitalRead(BUTTON_PIN);
  if (btn != lastBtn && millis() - btnChange > DEBOUNCE_MS) {
    btnChange = millis();
    lastBtn = btn;
    if (btn == LOW) sendOnce();
  }
  if (AUTO_INTERVAL_MS && millis() - lastAuto >= AUTO_INTERVAL_MS) {
    lastAuto = millis();
    sendOnce();
  }
}

// ============================================
// ESP32 + UNIT-C6L (v3: 文字列送信 / Serial Module)
//
//   短押し (0.8秒以内に離す) : ピッ + "SHORT" を1通送信
//   長押し (10秒保持)        : 加速ピップ -> 10秒到達で "LONG" を1通送信 -> 連続ピー3秒
//   途中で離す (0.8〜10秒)   : ブッブッ(キャンセル音) + 何も送らない
//
// v2 (esp32c3_unit_c6l_lora) との違い:
//   ・G4 のパルス回数ではなく、確定結果を UART の文字列で UNIT-C6L に渡す
//     (UNIT-C6L の Serial Module が LoRa テキストとして送信する)
//   ・ポジション(A〜E)は送らない。ポジションはサーバー側の「ノードID -> ポジション」設定で決まる
//     -> 全ての送信機で同じファームウェアを使える / 送信機の交換時に書き換え不要
//   ・送信は UART TX の1本のみ (UNIT-C6L の G5 = txd は使わない。G5 が未接続の基板でも動く)
//
// UNIT-C6L の設定 (Meshtastic):
//   serial.enabled = true / serial.mode = TEXTMSG / serial.rxd = 4 / serial.txd = 5
//   serial.baud = BAUD_DEFAULT (38400)   ※ BAUD_115200 は文字化けした(実測) ので使わない
//   detection_sensor.enabled = false     (G4 を UART に使うため)
//   Modem Preset は LONG_FAST のまま (信頼性優先)
//
// 配線:
//   [ESP32-C3 SuperMini (本番基板)]
//     GPIO4 -> UNIT-C6L G4 (UART TX -> C6L rxd)
//     GPIO5 -> デバイススイッチ (SW) 短絡でLOW -> 押下検出
//     GPIO6 -> NMOS(TRIG) ローサイドMOSFET -> 24Vブザー (TRIG-GND間に10kΩプルダウン)
//   [ESP32-WROOM-32D DevKit (試験用)]
//     GPIO4  (D4)  -> UNIT-C6L G4
//     GPIO18 (D18) -> ジャンパ線で GND と短絡 = ボタン押下 (ボタン代用)
//     GPIO19 (D19) -> ブザー用の出力 (試験では未接続でよい)
//     ※ GPIO6 は WROOM のフラッシュ用ピンなので使えない
//   どちらも GND を UNIT-C6L と共通にすること
// ============================================

// ===== ピン定義 =====
#if CONFIG_IDF_TARGET_ESP32C3
const int UART_TX_PIN = 4;    // UNIT-C6L G4 へ (UART TX)
const int BUTTON_PIN  = 5;    // デバイススイッチ (内部プルアップ, 短絡=LOW)
const int BUZZER_PIN  = 6;    // ローサイドMOSFET (ブザー駆動)
#else
const int UART_TX_PIN = 4;    // UNIT-C6L G4 へ (UART TX)
const int BUTTON_PIN  = 18;   // ジャンパで GND 短絡 = 押下 (内部プルアップ)
const int BUZZER_PIN  = 19;   // ブザー用出力 (試験では未接続)
#endif

const unsigned long UART_BAUD = 38400;   // C6L側 serial.baud (BAUD_DEFAULT) と一致させる

// ===== タイミング設定 =====
const unsigned long SHORT_MAX_MS       = 800;    // これ以内に離したら短押し
const unsigned long HOLD_TIME          = 10000;  // 長押し判定 10秒 (押下開始から)
const unsigned long FINAL_BEEP_MS      = 3000;   // 長押し発火後の連続ピー
const unsigned long DEBOUNCE_MS        = 50;     // チャタリング除去 (ms)

// 起動音 / 確認音 / キャンセル音 / 加速ピップ
const unsigned long STARTUP_BEEP_MS      = 100;    // 起動音 各ピのON時間
const unsigned long STARTUP_GAP_MS       = 120;    // 起動音 ピ間のOFF
const unsigned long CONFIRM_BEEP_MS      = 90;     // 短押し確認音 ピッ
const unsigned long CANCEL_BEEP_MS       = 60;     // キャンセル音 ブッ (2回)
const unsigned long PIP_ON_MS            = 90;     // 各ピのON時間
const unsigned long PIP_INTERVAL_START   = 900;    // 最初のピ間隔 (ms)
const unsigned long PIP_INTERVAL_END     = 80;     // 直前のピ間隔 (ms)

// ===== 状態 =====
enum SystemState {
  STATE_IDLE,       // 待機
  STATE_PRESSED,    // 押下直後 (短押しか長押し開始か判定待ち)
  STATE_COUNTDOWN,  // 長押しカウントダウン中 (加速ピップ)
  STATE_FIRING      // 発火処理中 (ボタン無視)
};

SystemState   systemState       = STATE_IDLE;
unsigned long pressStart        = 0;
int           lastPrintedTenths = -1;

// 加速ピップ ステートマシン
bool          pipOn            = false;
unsigned long pipPhaseStart    = 0;
unsigned long lastPipEnd       = 0;

// チャタリング対策 (デバウンス)
bool          btnReading       = false;
bool          btnStable        = false;
unsigned long btnChangeTime    = 0;

// ----- 前方宣言 -----
bool readButtonDebounced();
void resetCountdownBeep();
void playStartupBeep();
void playCancelBeep();
void updateSerialCountdown(unsigned long elapsed);
void updateAcceleratingPip(unsigned long elapsed);
unsigned long calcPipInterval(unsigned long elapsed);
void sendMessage(const char *text);
void fireShort();
void fireLong();

unsigned long calcPipInterval(unsigned long elapsed) {
  if (elapsed >= HOLD_TIME) return PIP_INTERVAL_END;
  float progress = (float)elapsed / (float)HOLD_TIME;
  return PIP_INTERVAL_START
       - (unsigned long)((PIP_INTERVAL_START - PIP_INTERVAL_END) * progress);
}

bool readButtonDebounced() {
  bool reading = (digitalRead(BUTTON_PIN) == LOW);
  if (reading != btnReading) {
    btnReading    = reading;
    btnChangeTime = millis();
  }
  if ((millis() - btnChangeTime) >= DEBOUNCE_MS) {
    btnStable = btnReading;
  }
  return btnStable;
}

void resetCountdownBeep() {
  pipOn         = false;
  pipPhaseStart = millis();
  lastPipEnd    = millis();
  digitalWrite(BUZZER_PIN, LOW);
}

// 起動完了の合図: ピッ・ピッ (2回)
void playStartupBeep() {
  for (int i = 0; i < 2; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(STARTUP_BEEP_MS);
    digitalWrite(BUZZER_PIN, LOW);
    if (i < 1) delay(STARTUP_GAP_MS);
  }
}

// 長押しキャンセルの合図: ブッ・ブッ (短く2回)
void playCancelBeep() {
  for (int i = 0; i < 2; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(CANCEL_BEEP_MS);
    digitalWrite(BUZZER_PIN, LOW);
    if (i < 1) delay(CANCEL_BEEP_MS);
  }
}

void setup() {
  // 起動直後にブザーOFF (setup完了前の誤動作を抑える)
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // UART TX のアイドルは HIGH。Serial1 を開始するまで LOW/浮きのままだと
  // UNIT-C6L に不定なバイトが入り、ゴミ文字のメッセージが送られることがある
  pinMode(UART_TX_PIN, OUTPUT);
  digitalWrite(UART_TX_PIN, HIGH);

  Serial.begin(115200);
  Serial1.begin(UART_BAUD, SERIAL_8N1, -1, UART_TX_PIN);  // RXなし / TX のみ
  delay(500);

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  btnReading    = (digitalRead(BUTTON_PIN) == LOW);
  btnStable     = btnReading;
  btnChangeTime = millis();

  playStartupBeep();

  Serial.println("=== ESP32 + UNIT-C6L (v3 文字列送信) ===");
  Serial.println("起動完了 (ピピ)");
  Serial.printf("  UART TX=GPIO%d %lubps / ボタン=GPIO%d / ブザー=GPIO%d\n",
                UART_TX_PIN, UART_BAUD, BUTTON_PIN, BUZZER_PIN);
  Serial.printf("  短押し: %lu ms以内に離す -> \"SHORT\" 送信\n", SHORT_MAX_MS);
  Serial.printf("  長押し: %lu秒保持 -> \"LONG\" 送信\n", HOLD_TIME / 1000);
  Serial.printf("  ビープ: 加速ピップ 間隔 %lu~%lu ms -> 連続ピー %lu秒\n",
                PIP_INTERVAL_START, PIP_INTERVAL_END, FINAL_BEEP_MS / 1000);
  Serial.printf("  デバウンス: %lu ms\n", DEBOUNCE_MS);
}

void loop() {
  bool pressed = readButtonDebounced();

  // 発火中はボタン状態を無視
  if (systemState == STATE_FIRING) {
    delay(5);
    return;
  }

  // ===== 押下直後: 短押しか長押し開始かの判定待ち =====
  if (systemState == STATE_PRESSED) {
    unsigned long elapsed = millis() - pressStart;

    if (!pressed) {
      // SHORT_MAX_MS以内に離した -> 短押し確定
      systemState = STATE_FIRING;
      Serial.println("短押し確定");
      fireShort();
      systemState = STATE_IDLE;
      Serial.println("待機中...");
      delay(5);
      return;
    }

    if (elapsed > SHORT_MAX_MS) {
      // 保持継続 -> 長押しカウントダウンへ移行
      systemState       = STATE_COUNTDOWN;
      lastPrintedTenths = -1;
      resetCountdownBeep();
      Serial.println("長押しモード開始... (カウントダウン)");
    }

    delay(5);
    return;
  }

  // ===== 長押しカウントダウン中 =====
  if (systemState == STATE_COUNTDOWN) {
    unsigned long elapsed = millis() - pressStart;
    updateSerialCountdown(elapsed);

    // 10秒到達を最優先 (手を離す直前でも発火する)
    if (elapsed >= HOLD_TIME) {
      systemState = STATE_FIRING;
      digitalWrite(BUZZER_PIN, LOW);
      pipOn = false;
      Serial.println("残り:  0.0秒 -> 長押し発火!");
      fireLong();
      systemState = STATE_IDLE;
      lastPrintedTenths = -1;
      Serial.println("待機中...");
      delay(5);
      return;
    }

    if (!pressed) {
      // 途中で離した -> キャンセル (何も送らない)
      systemState       = STATE_IDLE;
      lastPrintedTenths = -1;
      resetCountdownBeep();
      playCancelBeep();
      Serial.println("押下解除 -> キャンセル (送信なし)");
    } else {
      updateAcceleratingPip(elapsed);
    }

    delay(5);
    return;
  }

  // ===== STATE_IDLE =====
  if (pressed) {
    systemState = STATE_PRESSED;
    pressStart  = millis();
    Serial.println("押下検出... (短押し/長押し判定中)");
  }

  delay(5);
}

// シリアル: 残り時間を0.1秒単位で改行表示
void updateSerialCountdown(unsigned long elapsed) {
  unsigned long remainMs = HOLD_TIME - elapsed;
  int tenths = (int)((remainMs + 50) / 100);

  if (tenths != lastPrintedTenths) {
    lastPrintedTenths = tenths;
    Serial.printf("残り: %2d.%1d秒\n", tenths / 10, tenths % 10);
  }
}

// 加速ピップ (間隔が短くなる連続ビープ, ノンブロッキング)
void updateAcceleratingPip(unsigned long elapsed) {
  unsigned long now = millis();

  if (pipOn) {
    if (now - pipPhaseStart >= PIP_ON_MS) {
      digitalWrite(BUZZER_PIN, LOW);
      pipOn      = false;
      lastPipEnd = now;
    }
  } else {
    unsigned long interval = calcPipInterval(elapsed);
    if (now - lastPipEnd >= interval) {
      digitalWrite(BUZZER_PIN, HIGH);
      pipOn         = true;
      pipPhaseStart = now;
    }
  }
}

// UNIT-C6L へ1メッセージ送信 (Serial Module TEXTMSG は改行で1メッセージ確定)
// 本文は 20〜30バイト以内に保つこと (長いほど LoRa の送信時間が伸びて取りこぼしやすくなる)
void sendMessage(const char *text) {
  Serial1.print(text);
  Serial1.print('\n');
  Serial1.flush();
  Serial.printf("UART送信: %s\n", text);
}

// ===== 短押し発火: 送信 + 確認音ピッ =====
void fireShort() {
  sendMessage("SHORT");

  digitalWrite(BUZZER_PIN, HIGH);
  delay(CONFIRM_BEEP_MS);
  digitalWrite(BUZZER_PIN, LOW);

  Serial.println("短押し送信完了");
}

// ===== 長押し発火: 送信 + 連続ピー3秒 (手を離しても完走する) =====
void fireLong() {
  sendMessage("LONG");  // 先に送る (LoRaの伝送に約3秒かかるため、ブザーを待たない)

  digitalWrite(BUZZER_PIN, HIGH);
  delay(FINAL_BEEP_MS);
  digitalWrite(BUZZER_PIN, LOW);

  Serial.println("長押し送信完了");
}

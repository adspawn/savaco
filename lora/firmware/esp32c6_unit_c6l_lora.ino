// ============================================
// ESP32-C6 SuperMini + UNIT-C6L (v2: 短押し/長押し対応)
//
//   短押し (0.8秒以内に離す) : ピッ + G4パルス1回
//     -> サーバー側: 開始前=準備完了 / ゲーム中(無限復活戦)=復活カウント
//   長押し (10秒保持)        : 加速ピップ -> 連続ピー3秒 + G4パルス2回(3秒間隔)
//     -> サーバー側: ゲーム中(フラッグ戦・攻防戦)=フラッグ獲得
//   途中で離す (0.8秒〜10秒) : ブッブッ(キャンセル音) + 何も送らない
// ============================================
//
// 配線:
//   GPIO4 -> UNIT-C6L G4 (センサー通知 / Meshtastic Detection)
//   GPIO5 -> デバイススイッチ (SW) 短絡でLOW -> 押下検出
//   GPIO6 -> NMOS(TRIG) ローサイドMOSFET -> 24Vブザー
//          TRIG-GND 間に 10kΩ プルダウン (書き込み時の誤鳴動防止)
//
// 電源: モバイルバッテリー 5V
// ブザー: DCDCで24V昇圧
//
// 注意: Meshtastic側の Detection Sensor 設定で
//       Minimum Broadcast Seconds を 1 にすること
//       (3のままだと長押しの2回目のパルスが送信されないことがある)
// ============================================

// ===== ピン定義 (ESP32-C6 SuperMini) =====
const int C6L_PIN    = 4;   // UNIT-C6L G4 へ通知
const int BUTTON_PIN = 5;   // デバイススイッチ (内部プルアップ, 短絡=LOW)
const int MOSFET_PIN = 6;   // ローサイドMOSFET (ブザー駆動)

// ===== タイミング設定 =====
const unsigned long SHORT_MAX_MS       = 800;    // これ以内に離したら短押し
const unsigned long HOLD_TIME          = 10000;  // 長押し判定 10秒 (押下開始から)
const unsigned long PULSE_HIGH_MS      = 1000;   // G4 HIGH保持 (1パルスあたり)
const unsigned long PULSE_GAP_MS       = 2000;   // 長押し時の2パルス間のLOW時間
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
  digitalWrite(MOSFET_PIN, LOW);
}

// 起動完了の合図: ピッ・ピッ (2回)
void playStartupBeep() {
  for (int i = 0; i < 2; i++) {
    digitalWrite(MOSFET_PIN, HIGH);
    delay(STARTUP_BEEP_MS);
    digitalWrite(MOSFET_PIN, LOW);
    if (i < 1) delay(STARTUP_GAP_MS);
  }
}

// 長押しキャンセルの合図: ブッ・ブッ (短く2回)
void playCancelBeep() {
  for (int i = 0; i < 2; i++) {
    digitalWrite(MOSFET_PIN, HIGH);
    delay(CANCEL_BEEP_MS);
    digitalWrite(MOSFET_PIN, LOW);
    if (i < 1) delay(CANCEL_BEEP_MS);
  }
}

void setup() {
  // 起動直後にブザーOFF (setup完了前の誤動作を抑える)
  pinMode(MOSFET_PIN, OUTPUT);
  pinMode(C6L_PIN, OUTPUT);
  digitalWrite(MOSFET_PIN, LOW);
  digitalWrite(C6L_PIN, LOW);

  Serial.begin(115200);
  delay(2000);  // USB-CDC 安定化

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  btnReading    = (digitalRead(BUTTON_PIN) == LOW);
  btnStable     = btnReading;
  btnChangeTime = millis();

  playStartupBeep();

  Serial.println("=== ESP32-C6 + UNIT-C6L (v2) ===");
  Serial.println("起動完了 (ピピ)");
  Serial.printf("  短押し: %lu ms以内に離す -> G4パルス1回\n", SHORT_MAX_MS);
  Serial.printf("  長押し: %lu秒保持 -> G4パルス2回 (間隔 %lu ms)\n",
                HOLD_TIME / 1000, PULSE_HIGH_MS + PULSE_GAP_MS);
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
      Serial.println("短押し確定 -> パルス1回送信");
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
      digitalWrite(MOSFET_PIN, LOW);
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
      digitalWrite(MOSFET_PIN, LOW);
      pipOn      = false;
      lastPipEnd = now;
    }
  } else {
    unsigned long interval = calcPipInterval(elapsed);
    if (now - lastPipEnd >= interval) {
      digitalWrite(MOSFET_PIN, HIGH);
      pipOn         = true;
      pipPhaseStart = now;
    }
  }
}

// ===== 短押し発火: 確認音ピッ + G4パルス1回 =====
void fireShort() {
  Serial.println("G4パルス送信 (1回)");

  digitalWrite(C6L_PIN, HIGH);

  // パルス送出中に確認音を鳴らす
  digitalWrite(MOSFET_PIN, HIGH);
  delay(CONFIRM_BEEP_MS);
  digitalWrite(MOSFET_PIN, LOW);
  delay(PULSE_HIGH_MS - CONFIRM_BEEP_MS);

  digitalWrite(C6L_PIN, LOW);

  Serial.println("短押し送信完了");
}

// ===== 長押し発火: 連続ピー3秒 + G4パルス2回 (手を離しても完走する) =====
void fireLong() {
  Serial.println("G4ダブルパルス + 連続ピー開始");

  // パルス1回目 (ブザーON開始)
  digitalWrite(C6L_PIN, HIGH);
  digitalWrite(MOSFET_PIN, HIGH);
  delay(PULSE_HIGH_MS);           // 0.0-1.0s: G4 HIGH
  digitalWrite(C6L_PIN, LOW);

  delay(PULSE_GAP_MS);            // 1.0-3.0s: G4 LOW (ブザーは鳴りっぱなし = 計3秒)
  digitalWrite(MOSFET_PIN, LOW);

  // パルス2回目 (1回目の開始から3秒後)
  digitalWrite(C6L_PIN, HIGH);
  delay(PULSE_HIGH_MS);           // 3.0-4.0s: G4 HIGH
  digitalWrite(C6L_PIN, LOW);

  Serial.println("長押し送信完了 (パルス2回)");
}

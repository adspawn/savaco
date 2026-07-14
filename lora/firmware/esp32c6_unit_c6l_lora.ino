// ============================================
// ESP32-C6 SuperMini + UNIT-C6L
// 10秒長押し -> カウントダウンブザー + G4通知
// ============================================
//
// 配線:
//   GPIO4 -> UNIT-C6L G4 (センサー通知 / Meshtastic Detection)
//   GPIO5 -> デバイススイッチ (SW) 短絡でLOW -> 長押し検出
//   GPIO6 -> NMOS(TRIG) ローサイドMOSFET -> 24Vブザー
//          TRIG-GND 間に 10kΩ プルダウン (書き込み時の誤鳴動防止)
//
// 電源: モバイルバッテリー 5V
// ブザー: DCDCで24V昇圧
// ============================================

// ===== ピン定義 (ESP32-C6 SuperMini) =====
const int C6L_PIN    = 4;   // UNIT-C6L G4 へ通知
const int BUTTON_PIN = 5;   // デバイススイッチ (内部プルアップ, 短絡=LOW)
const int MOSFET_PIN = 6;   // ローサイドMOSFET (ブザー駆動)

// ===== タイミング設定 =====
const unsigned long HOLD_TIME          = 10000;  // 長押し判定 10秒
const unsigned long FINAL_BEEP_MS      = 3000;   // 10秒到達後の連続ピー 3秒
const unsigned long C6L_PULSE_MS       = 3000;   // G4 HIGH保持 (発火と同時)
const unsigned long DEBOUNCE_MS        = 50;     // チャタリング除去 (ms)

// 起動音 / 加速ピップ
const unsigned long STARTUP_BEEP_MS      = 100;    // 起動音 各ピのON時間
const unsigned long STARTUP_GAP_MS       = 120;    // 起動音 ピ間のOFF
const unsigned long PIP_ON_MS            = 90;     // 各ピのON時間
const unsigned long PIP_INTERVAL_START   = 900;    // 最初のピ間隔 (ms)
const unsigned long PIP_INTERVAL_END     = 80;     // 直前のピ間隔 (ms)

// ===== 状態 =====
enum SystemState { STATE_IDLE, STATE_COUNTDOWN, STATE_FIRING };

SystemState   systemState      = STATE_IDLE;
unsigned long pressStart       = 0;
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
void playPressBeep();
void updateSerialCountdown(unsigned long elapsed);
void updateAcceleratingPip(unsigned long elapsed);
unsigned long calcPipInterval(unsigned long elapsed);
void fire();

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

// 押下直後の確認音: ピッ (1回)
void playPressBeep() {
  digitalWrite(MOSFET_PIN, HIGH);
  delay(PIP_ON_MS);
  digitalWrite(MOSFET_PIN, LOW);
  lastPipEnd = millis();
  pipOn      = false;
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

  Serial.println("=== ESP32-C6 + UNIT-C6L ===");
  Serial.println("起動完了 (ピピ)");
  Serial.println("GPIO5 を 10秒長押しで発火");
  Serial.printf("  ビープ: 加速ピップ 間隔 %lu~%lu ms -> 連続ピー %lu秒\n",
                PIP_INTERVAL_START, PIP_INTERVAL_END, FINAL_BEEP_MS / 1000);
  Serial.printf("  デバウンス: %lu ms\n", DEBOUNCE_MS);
}

void loop() {
  bool pressed = readButtonDebounced();

  // 発火中 (3秒連続ピー) はボタン状態を無視
  if (systemState == STATE_FIRING) {
    delay(5);
    return;
  }

  if (systemState == STATE_COUNTDOWN) {
    unsigned long elapsed = millis() - pressStart;
    updateSerialCountdown(elapsed);

    // 10秒到達を最優先 (手を離す直前でも発火する)
    if (elapsed >= HOLD_TIME) {
      systemState = STATE_FIRING;
      digitalWrite(MOSFET_PIN, LOW);
      pipOn = false;
      Serial.println("残り:  0.0秒 -> 発火!");
      fire();
      systemState = STATE_IDLE;
      lastPrintedTenths = -1;
      Serial.println("待機中...");
      delay(5);
      return;
    }

    if (!pressed) {
      systemState         = STATE_IDLE;
      lastPrintedTenths   = -1;
      resetCountdownBeep();
      Serial.println("押下解除 (リセット)");
    } else {
      updateAcceleratingPip(elapsed);
    }

    delay(5);
    return;
  }

  // STATE_IDLE
  if (pressed) {
    systemState       = STATE_COUNTDOWN;
    pressStart        = millis();
    lastPrintedTenths = -1;
    resetCountdownBeep();
    playPressBeep();
    Serial.println("押下開始... (カウントダウン)");
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

// ===== 10秒到達 -> G4通知 + 連続ピー3秒 (手を離しても鳴り続ける) =====
void fire() {
  Serial.println("G4通知 + 連続ピー開始");

  digitalWrite(C6L_PIN, HIGH);
  digitalWrite(MOSFET_PIN, HIGH);
  delay(FINAL_BEEP_MS);
  digitalWrite(MOSFET_PIN, LOW);
  digitalWrite(C6L_PIN, LOW);

  Serial.println("発火完了");
}

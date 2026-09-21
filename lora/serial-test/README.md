# Serial Module (TEXTMSG) 検証手順

目的: ESP32-C3 が UART で送った文字列が、判定ウィンドウ待ちなしで即座に LoRa 経由で受信側へ届くか確認する。

## 前提となる事実

- UNIT-C6L の Grove 端子で使える信号線は **G4 / G5 の2本のみ** ([M5 docs](https://docs.m5stack.com/en/unit/Unit_C6L))
- G4 は現在 Detection Sensor (monitor pin=4) が使用中 → **同じピンを UART rxd に流用するので Detection Sensor は無効化が必須**
- 本命は ESP32 → C6L (D4→G4)。C6L の txd (G5) は ESP32 の RX(D5) に接続し、C6L が出力する内容の確認用に使う
- TEXTMSG は **改行で1メッセージ確定**し、プライマリチャンネルへブロードキャストされる
- `serial.timeout` は SIMPLE モードのフレーミング用 (250ms)。TEXTMSG では改行が区切りのはず → 実測で確認

## 機材

| 役割 | 機材 | PC接続 |
|------|------|--------|
| 送信ノード(テスト用1台) | UNIT-C6L + ESP32 (WROOM-32D) | C6L: 設定変更時のみ / ESP32: 計測時にUSB |
| 受信ノード | UNIT-C6L | USB (現行の受信機と同じ) |

送受信で LoRa 設定(リージョン・Modem Preset・PSK)が同じであること。

## 手順

### 0. 送信ノードの現設定をバックアップ (戻せるように)

```bash
meshtastic --port <送信C6L> --export-config > lora/serial-test/sender_backup.yaml
```

### 1. 送信ノードの設定変更

```bash
meshtastic --port <送信C6L> \
  --set detection_sensor.enabled false \
  --set serial.enabled true \
  --set serial.mode TEXTMSG \
  --set serial.rxd 4 --set serial.txd 5 \
  --set serial.baud BAUD_DEFAULT \
  --set serial.timeout 250
```

**ボーレートは BAUD_DEFAULT (38400) にすること。** `BAUD_115200` を指定しても C6L 側が 38400 相当で受信し、本文が文字化けした (実測)。ESP32 側スケッチも 38400 に合わせる。

自動で再起動する。`meshtastic --port <送信C6L> --get serial` で反映確認。

### 2. 配線 (送信ノード / ブレッドボード + ジャンパ)

試験では ESP32-WROOM-32D (DevKit) を使用。C3 でも可 (その場合 BUTTON_PIN を5等に変更)。

```
ESP32 D4  -> C6L G4    (ESP32 TX -> C6L rxd)
ESP32 D5  <- C6L G5    (C6L txd  -> ESP32 RX / デバッグ用)
ESP32 GND -> C6L GND
```

5V / 3V3 は接続しない (電源は各自のUSB)。

### 3. 書き込み

`uart_sender_test/uart_sender_test.ino` を ESP32 に書き込む (WROOM-32D: ボード "ESP32 Dev Module")。
デフォルトは15秒ごとに自動送信 + BOOTボタン(GPIO0)でも送信。
書き込み・ポートオープン時にDTR/RTSでリセットされる点に注意 (連番が1に戻る)。

### 4-a. まず「届くか」だけ確認 (計測なし)

```bash
python3 lora/serial-test/latency_test.py --recv-port <受信C6L>
# または
meshtastic --port <受信C6L> --listen
```

`SHORT:A#1` のようなテキストが届けば成功。

### 4-b. 遅延を測る (ESP32もUSBでPCに接続)

```bash
python3 lora/serial-test/latency_test.py --recv-port <受信C6L> --sender-port <ESP32>
```

20回ほど流して min / median / max を見る。比較対象は現行方式の「4.5秒〜」。

ポート一覧: `ls /dev/cu.usb*` (WROOM-32D は `usbserial-*` や `wchusbserial*` になることが多い)

## 見るべきポイント

| 確認 | 期待 | ダメだった場合の疑い |
|------|------|----------------------|
| テキストが届く | 届く | C6でserialモジュール未対応/ピン指定不可 → `--get serial`, デバイスログ確認 |
| 遅延 | 数百ms〜1秒台 | timeout待ち / Modem Preset(LongFast等)のairtime / 中継ホップ |
| 1回送信で1通のみ | 1通 | echo設定・二重送信 |
| 起動直後の初回欠落 | (既知) | 起動後30〜60秒待ってから測る |
| 本文文字化け/欠け | なし | baud不一致 (両側38400か) |

## 元に戻す

```bash
meshtastic --port <送信C6L> --configure lora/serial-test/sender_backup.yaml
```

## 実測結果 (2026-09-21, C414 -> CCCC, 同室・約1m, hop=0)

ESP32 が UART へ送信した瞬間 → 受信ノード(USB API)でテキスト受信、までの PC クロックでの差。

| Modem Preset | Serial Module 経由 | 対照: API直接送信 (Serial Module なし) |
|---|---|---|
| LONG_FAST | 約3.1秒 (3.05〜3.24, n=9) | 約2.2〜2.6秒 (外れ値4.7秒あり, n=6) |
| SHORT_FAST | 約2.6秒 (2.57〜2.65, n=12) | 未計測 |
| SHORT_TURBO | 約2.58秒 (2.56〜2.60, n=9) | 約2.1〜2.6秒 (n=6) |

- Serial Module 経由の TEXTMSG は正しく届く (1送信=1通)。判定ウィンドウは不要になる。
- Preset を短くしても約2.5秒の下限が残る。**airtime が支配的ではない**。Serial Module 自体の加算分も小さい (~0.1〜0.7秒)。
  下限の原因は未特定 (Meshtastic の送信キュー/送信前待機, 受信側USB API配信 などが候補)。

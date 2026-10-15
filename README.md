# サバゲー進行システム (v2)

サバイバルゲーム（サバゲー）の進行（休憩→開始前→ゲーム中→終了）を自動化・見える化するシステムです。
管理者はタブレット等の「管理画面」で操作し、フィールドの「表示画面」（TV/プロジェクター）にゲーム状況をリアルタイム表示します。
各ポジションのボタン発火は M5Stack UNIT-C6L (Meshtastic) 経由でLoRa受信し、自動でゲーム進行に反映されます。

> v1からの主な変更点: LoRa通信をM5Stack UNIT-C6L (Meshtastic) 方式に統一し、UIをレイアウトから全面刷新しました。
> 音声ファイル（.wav）は別途作成予定のため、本バージョンにはまだ含まれていません（フォルダ構成のみ用意済み）。

## システム構成

```
[各ポジションの送信デバイス]         [受信PC]
 ESP32-C3 + UNIT-C6L(送信)          UNIT-C6L(USB接続) ── Node.jsサーバー ── Socket.IO ──┬─ 管理画面(admin)
   10秒長押しで発火 → Meshtastic                                                        └─ 表示画面(display)
   Detection Sensor で LoRa 通知
```

- 送信側は「10秒長押しでMeshtastic経由のLoRa通知を飛ばす」だけの単純なデバイス（`lora/firmware`参照）。
- 受信側はUNIT-C6LをサーバーPCにUSB接続するだけ。サーバーは `@meshtastic/core` でシリアルのパケットを受信し、
  テキストを解釈してゲーム状態を更新します。**LoRaの送信プロトコルを自前実装する必要はありません。**
  受信して届いたテキストをキャッチするだけで完結します（`server/lora.js` / `server/meshtasticBridge.mjs`）。

## セットアップ

1. 依存関係のインストール
   ```bash
   npm install
   ```
   > `@meshtastic/core` が `preinstall` で pnpm を要求し、環境によっては
   > `npx only-allow pnpm` の実行に失敗して `npm install` がエラーになることがあります。
   > その場合は `npm install --ignore-scripts` を使ってください（動作に問題ありません）。

2. 環境変数の設定
   ```bash
   cp .env.example .env
   ```
   `.env` を編集してポート番号・UNIT-C6LのCOMポート番号などを設定してください。

3. サーバー起動
   ```bash
   npm start
   ```
   開発中は `npm run dev`（nodemon）が便利です。

4. ブラウザでアクセス
   - 管理画面: http://localhost:3000/admin/
   - 表示画面: http://localhost:3000/display/

`NODE_ENV=development`（`.env`のデフォルト）の場合、Meshtastic通信は初期化されません。
実機なしで動作確認したい場合は、管理画面下部の「デバッグ情報」パネルにあるテスト信号ボタンで
LoRa受信相当の動作をシミュレートできます。

本番でMeshtastic受信を有効にするには `.env` の `NODE_ENV=production` にし、`SERIAL_PORT` を実際の
UNIT-C6LのCOMポートに設定してください。

## ゲーム進行フェーズ

1. **待機中 (waiting)** - 休憩時間・ルール・制限時間・チーム位置を設定
2. **休憩中 (interval)** - カウントダウン。残り時間に応じて音声アナウンス（音声ファイル未配置時はスキップ）
3. **ゲーム開始前 (pre-game)** - 各チームの準備完了を待機（手動チェック or Meshtasticボタン）。両チーム準備完了で自動進行も可
4. **ゲーム中 (in-game)** - 制限時間カウントダウン。フラッグ戦/攻防戦はボタン検知で即終了、無限復活戦はボタン回数をカウント
5. **ゲーム終了 (game-over)** - 結果表示・自動保存（`results/`に保存）。「新しいゲーム」で待機中へ

ルールは以下の3種類（`server/state.js`の`GAME_OPTIONS`で定義）:
- フラッグ戦 / 攻防戦: どちらかのチームのボタン検知で即ゲーム終了
- 無限復活戦: ボタン検知のたびにカウントし、時間切れで引き分け集計

## LoRa (Meshtastic) 連携

- 送信側ファームウェア: [`lora/firmware/esp32c3_unit_c6l_lora/esp32c3_unit_c6l_lora.ino`](lora/firmware/esp32c3_unit_c6l_lora/esp32c3_unit_c6l_lora.ino)
  （ESP32-C3 SuperMini + UNIT-C6L、ボタン10秒長押しで発火）
- ハードウェア構成・配線・Meshtastic設定（Detection Sensor等）の詳細は [`lora/README.md`](lora/README.md) を参照
- 受信側は `server/lora.js` が届いたテキストからポジション(A〜E)を解決し、現在のゲームフェーズに応じて
  「準備完了」または「ボタン押下」として処理します
- `LORA_NODE_MAP`（`.env`）でMeshtasticの短縮ノードID(例: `D0E4`)とポジションを紐付けます（現在5台構成、詳細は[`lora/README.md`](lora/README.md)）
- 受信パケットのRSSI/SNR（電波品質）は管理画面のデバッグパネルに表示されます

## 予約カレンダーの取得（他フィールドの予約人数）

各フィールドが公開している Google カレンダー（iCal）を取得し、予定のタイトルから **日ごとの予約人数** を AI で判定して保存します。
タイトルの書き方はフィールドごと・予定ごとにバラバラ（「2名　川崎様」「貸切　10〜20名　初心者パック1」「３〜４名」など）なので、
人数の判定は Claude に任せています。「初心者パック3」「ガン10」のようなレンタル数や、「30名様まで」のような定員は人数として数えません。

AI 判定には **Claude Code CLI（`claude -p`）** を使います。Pro プランでログインしていれば **API キーは不要** で、
Pro の利用枠の中で動きます。同じタイトル（例「2名様」）は1回しか判定せず、結果は `reservations/data/cache.json` に保存されるため、
毎日の実行で AI に送られるのは新しく追加・変更された予定だけです。

### 準備

1. Node.js 18 以上（`fetch` を使うため）
2. Claude Code をインストールし、Pro アカウントでログイン
   ```bash
   claude        # 初回はブラウザでログイン。ログインできたら /exit で終了
   ```
3. 対象フィールドを `reservations/fields.json` に追加（`icsUrl` は Google カレンダーの「iCal 形式の公開アドレス」）
   ```json
   [
     { "id": "itoshima-isgf", "name": "糸島ISGF", "icsUrl": "https://calendar.google.com/calendar/ical/.../public/basic.ics" }
   ]
   ```

### 実行

```bash
npm run reservations -- --all       # 初回: 過去分もすべて判定（糸島ISGFで約17回 claude を呼びます）
npm run reservations                # 通常: 直近30日以降の未判定分だけ判定
npm run reservations -- --dry-run   # 取得と件数確認だけ（AI を呼ばない）
```

その他のオプション: `--field <id>`（1フィールドだけ）、`--since 2026-01-01`、`--max-calls N`、`--ics <ファイル>`（ダウンロード済みの .ics を使う）。

Pro の利用上限に達した場合や、1回の実行で `RESERVATION_MAX_CALLS`（既定30回）を超えた場合は、そこで止まります。
判定済みの分は保存されているので、次回の実行で続きから処理されます。

### 出力

| ファイル | 内容 |
|---|---|
| `reservations/data/<id>/days.json` | 日ごとの集計（人数の最小〜最大、休業、貸切、満員、人数不明の件数、元の予定と判定結果） |
| `reservations/data/daily.csv` | 全フィールドの日ごとの集計（Excel でそのまま開けます） |
| `reservations/data/<id>/calendar.ics` | 取得した元データ |

`people_min` / `people_max` は「3〜4名」のような幅を考慮した合計です。`open_ended` は「10名様〜」のような上限なしの予約があること、
`unknown_people` は人数が書かれていない予約の件数を表します。

### 毎日 23:30 に自動実行する（Windows）

コマンドプロンプトで次を実行します（`C:\path\to\savaco` はこのフォルダの場所に置き換え）。

```bat
schtasks /Create /TN "SavacoReservations" /SC DAILY /ST 23:30 /TR "cmd /c cd /d C:\path\to\savaco && npm run reservations >> reservations\update.log 2>&1"
```

- Claude Code のログイン情報を使うため、タスクは **ログインしているユーザーで** 実行されます（上のコマンドの既定）。
- PC がスリープ中だと実行されません。「タスク スケジューラ」で該当タスクのプロパティ →「条件」→「タスクを実行するためにスリープを解除する」、
  「設定」→「スケジュールされた時刻にタスクを開始できなかった場合、すぐにタスクを実行する」をオンにしてください。
- `claude` が見つからないと出る場合は、`.env` の `CLAUDE_BIN` に `claude.exe` のフルパスを指定してください。

Mac / Linux の場合は `crontab -e` に `30 23 * * * cd /path/to/savaco && npm run reservations >> reservations/update.log 2>&1` を追加します。

## フォルダ構成

```
savacoV2/
├── server/            # Express + Socket.IO サーバー
│   ├── index.js        # エントリーポイント・APIルート
│   ├── state.js         # ゲーム状態管理（SSOT）
│   ├── socket.js         # Socket.IOイベント処理
│   ├── audioQueue.js      # 音声再生キュー・スケジューリング
│   ├── lora.js            # Meshtastic受信 → ゲーム状態反映
│   └── meshtasticBridge.mjs  # UNIT-C6Lシリアル受信ブリッジ
├── public/
│   ├── admin/           # 管理画面（タブレット等での操作用）
│   ├── display/         # 表示画面（TV/プロジェクター表示用）
│   └── assets/
│       ├── css/theme.css  # 共通デザインシステム
│       └── sounds/        # 音声ファイル配置場所（現状は空、README参照）
├── reservations/       # 他フィールドの予約カレンダー取得・AI 判定（npm run reservations）
│   ├── fields.json       # 対象フィールドと iCal URL
│   └── data/             # 判定結果の保存先（git 管理外）
├── lora/
│   ├── README.md         # ハードウェア構成・Meshtastic設定まとめ
│   └── firmware/          # 送信側ESP32-C3ファームウェア
└── results/              # ゲーム結果の自動保存先（JSON）
```

## 音声ファイルについて

音源は別途作成予定のため、`public/assets/sounds/` 配下には実ファイルがまだありません。
存在しないファイルは警告ログを出しつつスキップされるだけなので、音声なしでも進行システム自体は問題なく動作します。
必要なファイル名の一覧は [`public/assets/sounds/README.md`](public/assets/sounds/README.md) にまとめてあります。

## システム要件

- Node.js 16以上
- Windows（シリアル通信用。他OSでも`SERIAL_PORT`の指定形式を変えれば動作可能）

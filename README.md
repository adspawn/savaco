# サバゲー進行システム (v2)

サバイバルゲーム（サバゲー）の進行（休憩→開始前→ゲーム中→終了）を自動化・見える化するシステムです。
管理者はタブレット等の「管理画面」で操作し、フィールドの「表示画面」（TV/プロジェクター）にゲーム状況をリアルタイム表示します。
各ポジションのボタン発火は M5Stack UNIT-C6L (Meshtastic) 経由でLoRa受信し、自動でゲーム進行に反映されます。

> v1からの主な変更点: LoRa通信をM5Stack UNIT-C6L (Meshtastic) 方式に統一し、UIをレイアウトから全面刷新しました。
> 音声ファイル（.wav）は別途作成予定のため、本バージョンにはまだ含まれていません（フォルダ構成のみ用意済み）。

## システム構成

```
[各ポジションの送信デバイス]         [受信PC]
 ESP32-C6 + UNIT-C6L(送信)          UNIT-C6L(USB接続) ── Node.jsサーバー ── Socket.IO ──┬─ 管理画面(admin)
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

- 送信側ファームウェア: [`lora/firmware/esp32c6_unit_c6l_lora.ino`](lora/firmware/esp32c6_unit_c6l_lora.ino)
  （ESP32-C6 SuperMini + UNIT-C6L、ボタン10秒長押しで発火）
- ハードウェア構成・配線・Meshtastic設定（Detection Sensor等）の詳細は [`lora/README.md`](lora/README.md) を参照
- 受信側は `server/lora.js` が届いたテキストからポジション(A/B/C/D)を解決し、現在のゲームフェーズに応じて
  「準備完了」または「ボタン押下」として処理します
- `LORA_NODE_MAP`（`.env`）でMeshtasticノードIDとポジションを直接紐付けることも可能です

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
├── lora/
│   ├── README.md         # ハードウェア構成・Meshtastic設定まとめ
│   └── firmware/          # 送信側ESP32-C6ファームウェア
└── results/              # ゲーム結果の自動保存先（JSON）
```

## 音声ファイルについて

音源は別途作成予定のため、`public/assets/sounds/` 配下には実ファイルがまだありません。
存在しないファイルは警告ログを出しつつスキップされるだけなので、音声なしでも進行システム自体は問題なく動作します。
必要なファイル名の一覧は [`public/assets/sounds/README.md`](public/assets/sounds/README.md) にまとめてあります。

## システム要件

- Node.js 16以上
- Windows（シリアル通信用。他OSでも`SERIAL_PORT`の指定形式を変えれば動作可能）

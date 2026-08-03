# 音源一覧

`server/audioQueue.js` が実際に参照するファイル名と、収録状況をまとめています。
✅ = 収録済み　⚠️ = **未収録（あとで追加します）**　🗄️ = 収録済みだが現行の再生仕様では未使用（将来のルール拡張用に温存）

存在しないファイルは警告ログを出しつつスキップされるだけなので、⚠️の音声がなくても進行システム自体は問題なく動作します。

## interval/（休憩中）

休憩タイマーが 10:00 / 5:00 / 3:00 / 1:00 / 0:00 になった時点でそれぞれ再生。

| ファイル | 状態 | 用途 |
|---|---|---|
| game_start_10min_before.wav | ✅ | 「次のゲーム開始まで、10分前です。」 |
| game_start_5min_before.wav | ✅ | 「次のゲーム開始まで、5分前です。」(この後ゲーム内容を案内) |
| game_start_3min_before.wav | ✅ | 「次のゲーム開始まで、3分前です。」 |
| game_start_60sec_before.wav | ✅ | 「次のゲーム開始まで、60秒前です。」(1:00マーク、下記3つと連続再生) |
| entry_closing_soon.wav | ✅ | 「間もなく、ゲームのエントリーを締め切ります。」 |
| game_starting_soon.wav | ✅ | 「間もなくゲームを開始いたします。」 |
| gather_at_start_position.wav | ✅ | 「参加されるプレイヤーは、スタート位置へお集まりください。」 |
| entry_closed.wav | ✅ | 「ゲームのエントリーを締め切りました。以降のフィールド入場はできません。次のゲームまでお待ちください。」(0:00) |
| game_start_15min_before.wav | 🗄️ | 15分前アナウンス（現行の再生スケジュールには含まれていません） |

## pre-game/（開始前）

| ファイル | 状態 | 用途 |
|---|---|---|
| start_countdown.wav | ✅ | 「それではゲームを開始いたします、、、」(ゲーム開始ボタン押下時 / 自動進行時) |
| all_ready.wav | ⚠️ | 両チーム準備完了時のアナウンス |
| pre_game_safety_check.wav | ⚠️ | 開始前フェーズ中、60秒ごとの安全確認アナウンス |
| red_ready.wav / red_cancel.wav | ⚠️ | 赤チーム準備完了/キャンセル |
| yellow_ready.wav / yellow_cancel.wav | ⚠️ | 黄チーム準備完了/キャンセル |

## in-game/（ゲーム中）

制限時間残りが 30:01 / 20:01 / 10:01 / 5:01 / 3:01 / 1:01 になった時点で
`remaining.wav` + 該当の分数ファイルを再生。終了10秒前に3ファイルを連続再生。

| ファイル | 状態 | 用途 |
|---|---|---|
| remaining.wav | ✅ | 「制限時間、残り」(各分数アナウンスの前に再生) |
| 30min.wav / 20min.wav / 10min.wav / 5min.wav / 3min.wav / 1min.wav | ✅ | 残り分数 |
| 10sec_before_end.wav | ✅ | 「ゲーム終了まで10秒前」(終了10秒前、下記2つと連続再生) |
| 2min.wav | 🗄️ | 残り2分アナウンス（現行の再生スケジュールには含まれていません） |

## game-over/（終了）

| ファイル | 状態 | 用途 |
|---|---|---|
| game_end.wav | ✅ | 「ゲーム終了」(タイムアップ・手動終了時) |
| post_game_announcement.wav | ✅ | 「お疲れ様でした。ゲーム終了後は、、、」(終了アナウンスの締め) |
| flag_captured.wav | ✅ | 「ゲーム終了。フラッグが獲得されました。」(フラッグ戦・攻防戦で途中決着した場合) |
| game_end_safety.wav | 🗄️ | 旧仕様の終了後安全確認（3回連呼）。現行では未使用 |

## rule/（ルール説明の読み上げパーツ）

`次のゲームは → ルール名 → 制限時間は → ○分です → (追加ルールがあれば) → 赤チームは/位置 → 黄チームは/位置`
の順に休憩中の5分前アナウンスの後に再生。

### 基本パーツ

| ファイル | 状態 | 用途 |
|---|---|---|
| next_game.wav | ✅ | 「次のゲームは」 |
| current_game.wav | 🗄️ | 「今回のゲームは」(next_gameの言い回し違い、未使用) |
| time_limit.wav | ✅ | 「制限時間は」 |
| add_rule.wav | ✅ | 「追加のルールは」 |
| red_start_position.wav / yellow_start_position.wav | ✅ | 「赤チームは」/「黄色チームは」 |
| terrorist_start_position.wav | 🗄️ | 「テロリストチームは」(2チーム制の現行UIでは未使用) |
| a.wav 〜 z.wav | ✅ (26種) | ポジション名の読み上げ（NATOフォネティック: アルファ〜ズールー） |
| start_position_generic.wav | 🗄️ | 「地点スタート」(汎用、現行では各ポジション音声に統合済みのため未使用) |

### ルール名（ゲームモード）

現在UIで選択できるのは「フラッグ戦」「攻防戦」「無限復活戦」の3つのみ。それ以外は将来のモード追加用。

| ファイル | 状態 | UI選択肢 |
|---|---|---|
| mode_flag_battle.wav | ✅ | フラッグ戦 |
| mode_attack_defend.wav | ✅ | 攻防戦 |
| mode_counter_respawn.wav | ✅ | 無限復活戦 |
| mode_annihilation.wav | 🗄️ | (殲滅戦、未使用) |
| mode_team_deathmatch.wav | 🗄️ | (チームデスマッチ、未使用) |
| mode_vip.wav | 🗄️ | (大統領戦、未使用) |
| mode_fox_hunt.wav | 🗄️ | (狐狩り、未使用) |
| mode_counter_battle.wav | 🗄️ | (カウンター戦、未使用) |
| mode_king_of_the_hill.wav | 🗄️ | (キング・オブ・ザ・ヒル、未使用) |
| mode_spy.wav | 🗄️ | (スパイ戦、未使用) |
| mode_zombie.wav | 🗄️ | (ゾンビ戦、未使用) |
| mode_terminator.wav | 🗄️ | (ターミネター戦、未使用) |
| mode_handgun.wav | 🗄️ | (ハンドガン戦、未使用) |
| mode_battle_royale.wav | 🗄️ | (バトルロイヤル戦、未使用) |
| mode_medic.wav | 🗄️ | (メディック戦、未使用) |
| mode_rescue.wav | 🗄️ | (レスキュー戦、未使用) |
| mode_center_flag.wav | ⚠️ | (センターフラッグ戦、未収録・未使用) |
| mode_domination.wav | ⚠️ | (拠点制圧戦、未収録・未使用) |
| mode_bomb_plant.wav | ⚠️ | (爆弾設置戦、未収録・未使用) |

### 制限時間（分数）

UIの制限時間ドロップダウンは 1/2/3/5/10/15/20/30/40/50/60分 のみ選択可能。4/6/7/8/9/25分は将来のドロップダウン拡張用。

| ファイル | 状態 |
|---|---|
| time_1min.wav 〜 time_10min.wav（1,2,3,5,10分） | ✅ |
| time_15min.wav / time_20min.wav / time_30min.wav / time_40min.wav / time_50min.wav / time_60min.wav | ✅ |
| time_4min.wav / time_6min.wav / time_7min.wav / time_8min.wav / time_9min.wav / time_25min.wav | 🗄️ (UI未対応の時間、収録済み) |
| time_10sec.wav | ⚠️ | デバッグ用「5秒」ゲームを選んだ場合の制限時間アナウンス |

### 追加ルール

現在UIでチェックボックス選択できるのは「1回復活」「フルオート禁止」の2つのみ。他は将来のオプション拡充用。

| ファイル | 状態 | UI選択肢 |
|---|---|---|
| rule_fullauto_off.wav | ✅ | フルオート禁止 |
| rule_respawn_count_1.wav | ✅ | 1回復活 |
| rule_respawn_count_2.wav / rule_respawn_count_3.wav | 🗄️ | (2回復活/3回復活、UI未対応) |
| rule_respawn_infinite.wav | 🗄️ | (無限復活、UI未対応) |
| rule_respawn_enabled.wav | 🗄️ | (復活あり、UI未対応) |
| rule_respawn_method_counter.wav / rule_respawn_method_drum.wav / rule_respawn_method_teammate.wav | 🗄️ | 復活方法の案内（UIに方法選択がまだ無い） |
| rule_respawn_cutoff_1min.wav / _3min.wav / _5min.wav / _10min.wav | 🗄️ | 復活締切時間の案内（UI未対応） |
| rule_respawn_cutoff_zero_counter.wav | 🗄️ | 「カウンターの数字がゼロの場合は復活できません」（UI未対応） |
| rule_respawn_exit_instruction.wav | 🗄️ | 「復活できないプレイヤーは...退場してください」（UI未対応） |
| rule_semi_auto_only.wav | 🗄️ | (セミオート限定、UI未対応) |
| rule_no_electric_gun.wav | 🗄️ | (電動ガンの使用禁止、UI未対応) |
| rule_no_japanese.wav / rule_no_english.wav | 🗄️ | (日本語/英語の使用禁止、UI未対応) |
| rule_real_count.wav | 🗄️ | (リアルカウント、UI未対応) |

## other/（共通音）

| ファイル | 状態 | 用途 |
|---|---|---|
| horn.wav | ✅ | ゲーム終了の合図（タイムアップ/フラッグ獲得/手動終了、いずれも終了アナウンスの先頭で再生） |
| buzzer_1times.wav / buzzer_2times.wav / buzzer_3times.wav | ⚠️ | 未収録（現行仕様では使用していません） |
| danger.wav / earthquake_emergency_stop.wav / lightning_emergency_stop.wav / emergency_stop_safety.wav | ⚠️ | 緊急停止系（未収録・未使用） |

---

## 音源ファイルの命名規則について

音源は元々日本語ディレクトリ(`音源/`配下)で作成されていましたが、コード上の参照名(英語)と対応させるため、
`public/assets/sounds/` へコピーする際に上記の英語ファイル名へリネームしています。
元の日本語ファイル一式は `savacoV2/音源/` にそのまま残っています（重複削除はしていません）。

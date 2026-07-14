# 音声ファイルについて

このフォルダには実際の音声ファイル（.wav）はまだ含まれていません。
音源は別途作成予定のため、現時点ではフォルダ構成のみ用意しています。

音声ファイルが存在しない場合でも、サーバー・UIはエラーで停止せず、
「見つからないファイルをスキップしてログに警告を出す」という挙動で動作します
（`server/audioQueue.js` の `checkSoundFile` / `enqueueSound` を参照）。

## フォルダ構成と必要なファイル

音声が用意でき次第、以下のパスに `.wav` ファイルを配置してください。

```
public/assets/sounds/
├── pre-game/     # ゲーム開始前フェーズ
├── interval/     # 休憩中フェーズ
├── in-game/      # ゲーム中フェーズ
├── game-over/    # ゲーム終了フェーズ
├── rule/         # ルール説明（読み上げパーツ）
└── other/        # ブザー・ホーン等の共通音
```

### pre-game/
- all_ready.wav
- pre_game_safety_check.wav
- red_ready.wav / red_cancel.wav
- yellow_ready.wav / yellow_cancel.wav
- start_countdown.wav

### interval/
- game_start_15min_before.wav
- game_start_10min_before.wav
- game_start_5min_before.wav
- game_start_3min_before.wav
- game_start_60sec_before.wav
- field_entry_rules.wav
- entry_closed.wav

### in-game/
- remaining.wav
- 30min.wav / 20min.wav / 15min.wav / 10min.wav / 5min.wav / 3min.wav / 2min.wav
- 60sec.wav / 10sec.wav
- red_is.wav / yellow_is.wav
- objective_secured.wav
- bomb_planted_defuse.wav / bomb_defused.wav / bomb_exploded.wav（拡張ルール用・未使用可）

### game-over/
- game_result.wav
- red_win.wav / yellow_win.wav / game_draw.wav
- game_end_safety.wav

### rule/
- next_game.wav / time_limit.wav / add_rule.wav
- mode_flag_battle.wav / mode_attack_defend.wav / mode_counter_respawn.wav
- mode_team_deathmatch.wav / mode_center_flag.wav / mode_vip.wav / mode_fox_hunt.wav / mode_domination.wav / mode_bomb_plant.wav
- time_1min.wav ～ time_60min.wav / time_10sec.wav
- red_start_position.wav / yellow_start_position.wav
- a.wav ～ z.wav（ポジション名の読み上げ、A～Zのうち使用する分だけでOK）
- rule_respawn1_drum.wav / rule_fullauto_off.wav 等（オプションルール読み上げ）

### other/
- buzzer_1times.wav / buzzer_2times.wav / buzzer_3times.wav
- horn.wav
- danger.wav / earthquake_emergency_stop.wav / lightning_emergency_stop.wav / emergency_stop_safety.wav（緊急停止系・未使用可）

正確なファイル名の一覧は `public/admin/admin.js` の `preloadAudioFiles()` 内のリストと、
`server/audioQueue.js` の各 `schedule*Audio` 関数内の参照箇所も参照してください。

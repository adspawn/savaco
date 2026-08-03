// サバゲー進行システム - 音声キュー管理
// 音声の再生順序とタイミングを管理

const fs = require('fs');
const path = require('path');

// 音声キュー
let audioQueue = [];
let isPlaying = false;
let currentSound = null;
let nextPlayTimeoutId = null; // 次の再生予約（重複防止用）
let currentPlaybackId = 0; // 再生識別子（完了通知の整合性チェック）

// Socket.IOインスタンス（外部から設定）
let io = null;

// スケジュールされたタイマー・インターバルを管理
let scheduledTimers = [];
let scheduledIntervals = [];

// 現在のフェーズを追跡（外部から設定）
let currentPhase = null;

// 見つからなかったファイルのリスト（デバッグ用）
let notFoundFiles = [];

// キュー完了時のコールバック
let queueCompleteCallback = null;

// 特定の音声ファイルの完了を追跡するコールバック
let soundCompleteCallbacks = {}; // { filename: [callback1, callback2, ...] }

// Socket.IOインスタンスを設定
function setSocketIO(socketIO) {
  io = socketIO;
}

// キュー完了コールバックを設定（外部からアクセス可能）
function setQueueCompleteCallback(callback) {
  queueCompleteCallback = callback;

  // 登録時点で既にキューが空・アイドル状態なら（音声ファイル未配置等）、
  // 二度と playNext() が呼ばれず永久に完了しないため、即座に完了扱いにする
  if (callback && !isPlaying && audioQueue.length === 0) {
    queueCompleteCallback = null;
    setTimeout(callback, 0);
  }
}

// キュー完了コールバックを取得（外部からアクセス可能）
function getQueueCompleteCallback() {
  return queueCompleteCallback;
}

// 音声ファイルの存在確認（ファイルが存在しない場合も警告のみで続行）
function checkSoundFile(filename) {
  // buzzer_2times.wavやhorn.wavなど、まだ追加されていないファイルは警告のみ
  const soundPath = path.join(__dirname, '..', 'public', 'assets', 'sounds', filename);
  const exists = fs.existsSync(soundPath);
  
  if (!exists && (filename.includes('buzzer') || filename.includes('horn'))) {
    console.warn(`⚠️ Optional sound file not found: ${filename} (will skip)`);
    return false;
  }
  
  return exists;
}

// 音声をキューに追加
function enqueueSound(filename, priority = 0) {
  if (!checkSoundFile(filename)) {
    console.error(`❌ NOT FOUND: ${filename}`);
    console.error(`   Expected path: public/assets/sounds/${filename}`);
    
    // 見つからなかったファイルをリストに追加
    if (!notFoundFiles.includes(filename)) {
      notFoundFiles.push(filename);
    }
    
    return false;
  }
  
  const soundItem = {
    filename,
    priority,
    timestamp: Date.now()
  };
  
  // 優先度順にソート
  audioQueue.push(soundItem);
  audioQueue.sort((a, b) => b.priority - a.priority || a.timestamp - b.timestamp);
  
  console.log(`✅ Sound enqueued: ${filename} (priority: ${priority})`);
  
  // 再生中でなければ再生開始
  if (!isPlaying) {
    playNext();
  }
  
  return true;
}

// 複数の音声をシーケンスとして追加
function enqueueSequence(filenames, priority = 0) {
  let addedCount = 0;
  filenames.forEach((filename, index) => {
    const added = enqueueSound(filename, priority - index * 0.1); // 微小な優先度差で順序保証
    if (added) addedCount++;
  });
  return addedCount;
}

// 次の音声を再生
function playNext() {
  // すでに再生中なら二重起動を防止
  if (isPlaying) {
    return;
  }

  if (audioQueue.length === 0) {
    isPlaying = false;
    currentSound = null;
    
    // キューが空になった場合、コールバックがあれば実行
    if (queueCompleteCallback) {
      console.log('✅ Audio queue complete, executing callback');
      const callback = queueCompleteCallback;
      queueCompleteCallback = null; // コールバックをクリア
      callback();
    }
    
    return;
  }
  
  const soundItem = audioQueue.shift();
  currentSound = soundItem.filename;
  isPlaying = true;
  currentPlaybackId += 1;
  
  console.log(`Playing sound: ${currentSound}`);
  
  // 管理画面に音声再生指示を送信
  if (io) {
    io.to('admin').emit('playSound', { filename: currentSound, playbackId: currentPlaybackId });
  }
}

// 特定の音声ファイルの完了コールバックを登録
function onSoundComplete(filename, callback) {
  // ファイルが存在せず再生され得ない場合（音声未配置など）、
  // 実際の再生完了通知を待つと永久にコールバックが実行されないため、即座に完了扱いにする
  if (!checkSoundFile(filename)) {
    setTimeout(callback, 0);
    return;
  }

  if (!soundCompleteCallbacks[filename]) {
    soundCompleteCallbacks[filename] = [];
  }
  soundCompleteCallbacks[filename].push(callback);
}

// 音声再生完了通知
function onSoundFinished(playbackId) {
  // 再生IDが一致しない場合は無視（重複/古い通知の防止）
  if (playbackId && playbackId !== currentPlaybackId) {
    console.log(`Ignoring soundFinished for stale playbackId=${playbackId}, current=${currentPlaybackId}`);
    return;
  }
  const finishedSound = currentSound;
  console.log(`Sound finished: ${finishedSound}`);
  currentSound = null;
  isPlaying = false;
  
  // 特定の音声ファイルの完了コールバックを実行
  if (finishedSound && soundCompleteCallbacks[finishedSound]) {
    const callbacks = soundCompleteCallbacks[finishedSound];
    soundCompleteCallbacks[finishedSound] = []; // コールバックをクリア
    callbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error(`Error in sound complete callback for ${finishedSound}:`, error);
      }
    });
  }
  
  // 次の音声を再生（間隔を長めに）
  // 既存の予約があればクリア（重複防止）
  if (nextPlayTimeoutId) {
    clearTimeout(nextPlayTimeoutId);
    nextPlayTimeoutId = null;
  }
  nextPlayTimeoutId = setTimeout(() => {
    nextPlayTimeoutId = null;
    playNext();
  }, 1000); // 1秒の間隔（音声が途切れないように）
}

// キューをクリア
function clearQueue() {
  audioQueue = [];
  isPlaying = false;
  currentSound = null;
  queueCompleteCallback = null; // コールバックもクリア
  // 音声完了コールバックもクリア
  soundCompleteCallbacks = {};
  if (nextPlayTimeoutId) {
    clearTimeout(nextPlayTimeoutId);
    nextPlayTimeoutId = null;
  }
  console.log('Audio queue cleared');
}

// すべてのスケジュールをクリア
function clearAllSchedules() {
  // すべてのタイマーをクリア
  scheduledTimers.forEach(timerId => clearTimeout(timerId));
  scheduledTimers = [];
  
  // すべてのインターバルをクリア
  scheduledIntervals.forEach(intervalId => clearInterval(intervalId));
  scheduledIntervals = [];
  
  console.log('All audio schedules cleared');
}

// タイマーを安全に設定（管理対象）
function setSafeTimeout(callback, delay) {
  const timerId = setTimeout(callback, delay);
  scheduledTimers.push(timerId);
  return timerId;
}

// インターバルを安全に設定（管理対象）
function setSafeInterval(callback, interval) {
  const intervalId = setInterval(callback, interval);
  scheduledIntervals.push(intervalId);
  return intervalId;
}

// 現在の状態を取得
function getAudioState() {
  return {
    queue: audioQueue.map(item => item.filename),
    isPlaying,
    currentSound,
    queueLength: audioQueue.length
  };
}

// ルール説明音声の生成（新しいファイル名に対応）
function createRuleExplanation(settings) {
  const sequence = [];
  
  console.log('=== Creating Rule Explanation ===');
  console.log('Settings:', JSON.stringify(settings, null, 2));
  
  // "次のゲームは"
  sequence.push('rule/next_game.wav');
  
  // ルール名（新しいファイル名に対応）
  switch(settings.rule) {
    case 'フラッグ戦':
      sequence.push('rule/mode_flag_battle.wav');
      break;
    case '攻防戦':
      sequence.push('rule/mode_attack_defend.wav');
      break;
    case '無限復活戦':
      sequence.push('rule/mode_counter_respawn.wav');
      break;
    // その他のルールも追加可能
    case '殲滅戦':
      sequence.push('rule/mode_team_deathmatch.wav');
      break;
    case 'センターフラッグ戦':
      sequence.push('rule/mode_center_flag.wav');
      break;
    case '大統領戦':
      sequence.push('rule/mode_vip.wav');
      break;
    case 'キツネ狩り':
      sequence.push('rule/mode_fox_hunt.wav');
      break;
    case '拠点制圧戦':
      sequence.push('rule/mode_domination.wav');
      break;
    case '爆弾設置戦':
      sequence.push('rule/mode_bomb_plant.wav');
      break;
  }
  
  // "制限時間は"
  sequence.push('rule/time_limit.wav');
  
  // 時間（新しいファイル名に対応）
  const gameMinutes = Math.floor(settings.gameTime / 60);
  if (gameMinutes >= 1) {
    // 60分、50分、40分、30分、20分、15分、10分、5分、3分、2分、1分
    if (gameMinutes >= 60) {
      sequence.push('rule/time_60min.wav');
    } else if (gameMinutes >= 50) {
      sequence.push('rule/time_50min.wav');
    } else if (gameMinutes >= 40) {
      sequence.push('rule/time_40min.wav');
    } else if (gameMinutes >= 30) {
      sequence.push('rule/time_30min.wav');
    } else if (gameMinutes >= 20) {
      sequence.push('rule/time_20min.wav');
    } else if (gameMinutes >= 15) {
      sequence.push('rule/time_15min.wav');
    } else if (gameMinutes >= 10) {
      sequence.push('rule/time_10min.wav');
    } else if (gameMinutes >= 5) {
      sequence.push('rule/time_5min.wav');
    } else if (gameMinutes >= 3) {
      sequence.push('rule/time_3min.wav');
    } else if (gameMinutes >= 2) {
      sequence.push('rule/time_2min.wav');
    } else if (gameMinutes >= 1) {
      sequence.push('rule/time_1min.wav');
    }
  } else {
    sequence.push('rule/time_10sec.wav');
  }
  
  // チーム位置
  sequence.push('rule/red_start_position.wav');
  sequence.push(`rule/${settings.teams.red.position.toLowerCase()}.wav`);
  
  sequence.push('rule/yellow_start_position.wav');
  sequence.push(`rule/${settings.teams.yellow.position.toLowerCase()}.wav`);
  
  // オプションルール
  if (settings.options && settings.options.length > 0) {
    sequence.push('rule/add_rule.wav');
    settings.options.forEach(option => {
      switch(option) {
        case '1回復活':
          // 復活方法(カウンター/ドラム缶/味方タッチ)はUI未対応のため回数のみ案内
          sequence.push('rule/rule_respawn_count_1.wav');
          break;
        case 'フルオート禁止':
          sequence.push('rule/rule_fullauto_off.wav');
          break;
      }
    });
  }
  
  console.log('Rule explanation sequence:', sequence);
  console.log('Total files:', sequence.length);
  
  return sequence;
}

// フェーズ別音声スケジューリング
function schedulePhaseAudio(phase, settings) {
  // 前のフェーズのスケジュールをクリア
  clearAllSchedules();
  clearQueue();

  // 現在のフェーズを更新
  currentPhase = phase;
  
  console.log(`Scheduling audio for phase: ${phase}`);
  
  switch(phase) {
    case 'waiting':
      // 待機フェーズでは音声スケジュールなし
      console.log('Waiting phase: no audio scheduled');
      break;
    case 'interval':
      scheduleIntervalAudio(settings);
      break;
    case 'pre-game':
      schedulePreGameAudio();
      break;
    case 'in-game':
      // in-gameフェーズの音声をスケジュール
      if (settings) {
        scheduleInGameAudio(settings);
      } else {
        console.warn('In-game phase: settings not provided for audio scheduling');
      }
      break;
    case 'game-over':
      scheduleGameOverAudio(settings);
      break;
  }
}

// 休憩中の音声スケジューリング
// タイマー(休憩残り時間)が 10:00 / 5:00 / 3:00 / 1:00 / 0:00 になった時点でそれぞれ再生
function scheduleIntervalAudio(settings) {
  const intervalTime = settings.intervalTime;
  const ruleSequence = createRuleExplanation(settings);

  // 10:00（600秒）のとき: 「次のゲーム開始まで、10分前です。」
  if (intervalTime >= 600) {
    setSafeTimeout(() => {
      enqueueSound('interval/game_start_10min_before.wav', 9);
    }, (intervalTime - 600) * 1000);
  }

  // 5:00（300秒）のとき: 「次のゲーム開始まで、5分前です。」→ ゲーム内容(ルール説明)
  if (intervalTime >= 300) {
    setSafeTimeout(() => {
      enqueueSound('interval/game_start_5min_before.wav', 9);
      // アナウンスの再生時間を考慮して少し待ってからルール説明を再生
      setSafeTimeout(() => {
        enqueueSequence(ruleSequence, 8);
      }, 3000);
    }, (intervalTime - 300) * 1000);
  }

  // 3:00（180秒）のとき: 「次のゲーム開始まで、3分前です。」
  if (intervalTime >= 180) {
    setSafeTimeout(() => {
      enqueueSound('interval/game_start_3min_before.wav', 9);
    }, (intervalTime - 180) * 1000);
  }

  // 1:00（60秒）のとき: 「60秒前です」→「間もなく締切ります」→「間もなく開始します」→「スタート位置へお集まりください」
  if (intervalTime >= 60) {
    setSafeTimeout(() => {
      enqueueSequence([
        'interval/game_start_60sec_before.wav',
        'interval/entry_closing_soon.wav',
        'interval/game_starting_soon.wav',
        'interval/gather_at_start_position.wav'
      ], 9);
    }, (intervalTime - 60) * 1000);
  }

  // 0:00のとき: 「エントリーを締め切りました…」
  setSafeTimeout(() => {
    enqueueSound('interval/entry_closed.wav', 9);
  }, intervalTime * 1000);
}

// ゲーム開始前の音声スケジューリング（新しいファイル名に対応）
// 注意: stateモジュールが必要（両チーム準備完了チェック用）
let stateModule = null;

function setStateModule(state) {
  stateModule = state;
}

function schedulePreGameAudio(settings, onComplete) {
  console.log('');
  console.log('========================================');
  console.log('🎯 PRE-GAME PHASE AUDIO');
  console.log('========================================');
  
  // 安全確認を再生する関数
  function playSafetyCheck() {
    // 現在のフェーズがpre-gameでない場合はスキップ
    if (currentPhase !== 'pre-game') {
      console.log('Skipping safety check: not in pre-game phase');
      return;
    }
    
    // 他の音声再生中はスキップ
    if (isPlaying) {
      console.log('Skipping safety check: audio is playing');
      return;
    }
    
    // 両チーム準備完了の場合はスキップ
    if (stateModule) {
      const currentState = stateModule.getState();
      const redReady = currentState.settings?.teams?.red?.ready || false;
      const yellowReady = currentState.settings?.teams?.yellow?.ready || false;
      
      if (redReady && yellowReady) {
        console.log('Skipping safety check: both teams are ready');
        return;
      }
    }
    
    console.log('Playing pre-game safety check sound');
    enqueueSound('pre-game/pre_game_safety_check.wav', 5);
  }
  
  // 最初の60秒間隔でも再生されるように、即座に1回再生
  playSafetyCheck();
  
  // その後、60秒ごとに再生
  setSafeInterval(playSafetyCheck, 60000);
  
  console.log('========================================');
  console.log('');
}

// 両チーム準備完了時のゲーム開始アナウンス（pre-game → in-game移行）
// 注意: ルール説明は休憩中(interval)の5分前アナウンスで既に再生済みのため、ここでは再度説明しない
function playRuleExplanationAndStart(settings, onComplete, autoProgress = false) {
  console.log('');
  console.log('========================================');
  console.log('🎮 BOTH TEAMS READY - STARTING GAME');
  console.log('========================================');

  const queueBefore = audioQueue.length;

  // 「それではゲームを開始いたします、、、」
  console.log('📢 Playing start countdown');
  enqueueSound('pre-game/start_countdown.wav', 9);

  const queueAfter = audioQueue.length;
  const totalAdded = queueAfter - queueBefore;
  
  console.log('');
  console.log(`Added ${totalAdded} audio files to queue`);
  
  if (totalAdded === 0) {
    console.warn('⚠️ No audio files found! Transitioning immediately...');
    // 音声ファイルがない場合は2秒後に移行
    setTimeout(() => {
      if (onComplete) {
        onComplete();
      }
    }, 2000);
  } else {
    console.log('Waiting for all audio to complete...');
    console.log('Will transition to in-game phase when audio queue is empty');
    console.log('========================================');
    console.log('');
    
    // キュー完了時のコールバックを設定
    if (onComplete) {
      queueCompleteCallback = onComplete;
    }
  }
}

// 手動ゲーム開始（ゲーム開始ボタンが押された時）
function playManualStart(onComplete) {
  console.log('');
  console.log('========================================');
  console.log('🎮 MANUAL GAME START');
  console.log('========================================');
  
  enqueueSound('pre-game/start_countdown.wav', 10);
  
  if (onComplete) {
    queueCompleteCallback = onComplete;
  }
}

// ゲーム中の音声スケジューリング
// 残り時間が 30:01/20:01/10:01/5:01/3:01/1:01 になった時点で「制限時間残り」+ 分数を再生
// (「制限時間はXX分です」という開始直後のルール説明と重複しないよう、
//  ちょうどgameTimeと同じ閾値のときはスキップする)
function scheduleInGameAudio(settings) {
  const gameTime = settings.gameTime;

  console.log('');
  console.log('========================================');
  console.log('🎮 SCHEDULING IN-GAME AUDIO');
  console.log('========================================');
  console.log('Game time:', gameTime, 'seconds');
  console.log('');

  const timePoints = [
    { time: 1800, file: 'in-game/30min.wav' }, // 30分
    { time: 1200, file: 'in-game/20min.wav' }, // 20分
    { time: 600, file: 'in-game/10min.wav' },  // 10分
    { time: 300, file: 'in-game/5min.wav' },   // 5分
    { time: 180, file: 'in-game/3min.wav' },   // 3分
    { time: 60, file: 'in-game/1min.wav' }     // 1分
  ];

  timePoints.forEach(({ time, file }) => {
    // ゲーム開始直後のアナウンスを避けるため、
    // 「制限時間」と同じタイミング（time === gameTime）では再生しない
    if (gameTime > time) {
      console.log(`  - ${time}s remaining: remaining + ${file}`);
      setSafeTimeout(() => {
        enqueueSequence(['in-game/remaining.wav', file], 8);
      }, (gameTime - time) * 1000);
    }
  });

  // 終了10秒前: horn.wav →「ゲーム終了まで10秒前」→「ゲーム終了」→「お疲れ様でした、、、」
  // (この4ファイルの再生自体に数秒かかるため、実際に喋り終わる頃には残り時間がほぼ0になる想定)
  if (gameTime > 10) {
    console.log('  - 10 seconds remaining: horn -> 10sec_before_end -> game_end -> post_game_announcement');
    setSafeTimeout(() => {
      enqueueSequence([
        'other/horn.wav',
        'in-game/10sec_before_end.wav',
        'game-over/game_end.wav',
        'game-over/post_game_announcement.wav'
      ], 10);
    }, (gameTime - 10) * 1000);
  }

  console.log('');
  console.log('========================================');
  console.log('✅ IN-GAME AUDIO SCHEDULING COMPLETE');
  console.log('========================================');
  
  // 見つからなかったファイルのサマリー
  if (notFoundFiles.length > 0) {
    console.log('');
    console.log('⚠️  MISSING AUDIO FILES SUMMARY:');
    console.log('----------------------------------------');
    console.log(`Total missing files: ${notFoundFiles.length}`);
    console.log('');
    console.log('Files to create:');
    notFoundFiles.forEach((file, index) => {
      console.log(`  ${index + 1}. ${file}`);
    });
    console.log('----------------------------------------');
    
    // リストをクリア（次回のため）
    notFoundFiles = [];
  } else {
    console.log('');
    console.log('✅ All audio files found!');
  }
  
  console.log('');
}

// [現在は未使用] 旧仕様のゲーム終了音声（勝敗アナウンス後にgame_end_safety.wavを3回再生）
// 現行のゲーム終了アナウンスは state.js の handleGameEnd() が
// game-over/game_end.wav 等を直接再生する形に変更されたため、この関数は呼ばれていない。
// game_end_safety.wav等の音源を用意して再度3回アナウンスしたくなった場合のために残してある。
function scheduleGameOverAudio(result) {
  console.log('');
  console.log('========================================');
  console.log('🏁 GAME OVER AUDIO - Safety Announcements');
  console.log('========================================');
  console.log('Note: horn.wav, game_result.wav, and winner announcement are already played');
  console.log('Now scheduling game_end_safety.wav (3 times)');
  console.log('');
  
  // game_end_safety.wavを3回再生
  // 1回目
  console.log('Game over: playing game_end_safety (1/3)');
  enqueueSound('game-over/game_end_safety.wav', 10);
  
  // 2回目（10秒後）
  setSafeTimeout(() => {
    console.log('Game over: playing game_end_safety (2/3)');
    enqueueSound('game-over/game_end_safety.wav', 9);
  }, 10000);
  
  // 3回目（20秒後）
  setSafeTimeout(() => {
    console.log('Game over: playing game_end_safety (3/3)');
    enqueueSound('game-over/game_end_safety.wav', 8);
  }, 20000);
  
  console.log('========================================');
  console.log('');
}

module.exports = {
  setSocketIO,
  setStateModule, // stateモジュール設定
  enqueueSound,
  enqueueSequence,
  playNext,
  onSoundFinished,
  onSoundComplete, // 特定の音声ファイルの完了コールバック登録
  clearQueue,
  clearAllSchedules,
  getAudioState,
  createRuleExplanation,
  schedulePhaseAudio,
  scheduleIntervalAudio,
  schedulePreGameAudio,
  scheduleInGameAudio,
  scheduleGameOverAudio,
  playRuleExplanationAndStart,
  playManualStart, // 手動ゲーム開始用
  setQueueCompleteCallback, // キュー完了コールバック設定
  getQueueCompleteCallback // キュー完了コールバック取得
};

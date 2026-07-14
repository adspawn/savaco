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
          // 復活方法が指定されていない場合はデフォルト
          sequence.push('rule/rule_respawn1_drum.wav');
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
  
  // キューをクリア（ただし、horn.wavが再生中の場合はスキップ）
  const audioState = getAudioState();
  if (audioState.currentSound !== 'other/horn.wav' && 
      !audioState.queue.some(item => item === 'other/horn.wav')) {
    clearQueue();
  } else {
    console.log('⚠️ horn.wav is playing or queued, skipping queue clear');
  }
  
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

// 休憩中の音声スケジューリング（新しいファイル名とブザー音に対応）
function scheduleIntervalAudio(settings) {
  const intervalTime = settings.intervalTime;
  const ruleSequence = createRuleExplanation(settings);
  
  // ②休憩時間フェーズの最初のルール説明は再生しない（削除）
  
  // タイマー15:00（900秒）のとき
  if (intervalTime >= 900) {
    setSafeTimeout(() => {
      enqueueSound('other/buzzer_2times.wav', 10);
      enqueueSound('interval/game_start_15min_before.wav', 9);
    }, (intervalTime - 900) * 1000);
  }
  
  // タイマー10:00（600秒）のとき
  if (intervalTime >= 600) {
    setSafeTimeout(() => {
      enqueueSound('other/buzzer_2times.wav', 10);
      enqueueSound('interval/game_start_10min_before.wav', 9);
    }, (intervalTime - 600) * 1000);
  }
  
  // タイマー5:00（300秒）のとき
  if (intervalTime >= 300) {
    setSafeTimeout(() => {
      enqueueSound('other/buzzer_2times.wav', 10);
      enqueueSound('interval/game_start_5min_before.wav', 9);
      // 5分前のアナウンス後にルール説明を再生
      // アナウンスの再生時間を考慮して少し待つ（約3秒後）
      setSafeTimeout(() => {
        enqueueSequence(ruleSequence, 8);
      }, 3000);
    }, (intervalTime - 300) * 1000);
  }
  
  // タイマー3:00（180秒）のとき
  if (intervalTime >= 180) {
    setSafeTimeout(() => {
      enqueueSound('other/buzzer_2times.wav', 10);
      enqueueSound('interval/game_start_3min_before.wav', 9);
      enqueueSound('interval/field_entry_rules.wav', 8);
    }, (intervalTime - 180) * 1000);
  }
  
  // タイマー1:00（60秒）のとき
  if (intervalTime >= 60) {
    setSafeTimeout(() => {
      enqueueSound('other/buzzer_2times.wav', 10);
      enqueueSound('interval/game_start_60sec_before.wav', 9);
      enqueueSound('interval/field_entry_rules.wav', 8);
    }, (intervalTime - 60) * 1000);
  }
  
  // タイマー0:00のとき
  setSafeTimeout(() => {
    enqueueSound('other/buzzer_2times.wav', 10);
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

// 両チーム準備完了時のルール説明（pre-game → in-game移行）
// 注意: all_ready.wavは既に再生されている前提
function playRuleExplanationAndStart(settings, onComplete, autoProgress = false) {
  console.log('');
  console.log('========================================');
  console.log('🎮 BOTH TEAMS READY - PLAYING RULE EXPLANATION');
  console.log('========================================');
  
  const queueBefore = audioQueue.length;
  
  // ルール説明音声（all_ready.wavは既に再生済み）
  const ruleSequence = createRuleExplanation(settings);
  const addedRules = enqueueSequence(ruleSequence, 9);
  
  // ルール説明後にbuzzer_2times.wavを再生
  console.log('');
  console.log('📢 Playing buzzer before start countdown');
  enqueueSound('other/buzzer_2times.wav', 8);
  
  // buzzer_2times.wavの後にstart_countdown.wavを再生（自動進行・手動開始の両方で）
  console.log('');
  console.log('📢 Playing start countdown after buzzer');
  enqueueSound('pre-game/start_countdown.wav', 7);
  
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

// ゲーム中の音声スケジューリング（新しいファイル名とブザー音に対応）
function scheduleInGameAudio(settings) {
  const gameTime = settings.gameTime;
  
  console.log('');
  console.log('========================================');
  console.log('🎮 SCHEDULING IN-GAME AUDIO');
  console.log('========================================');
  console.log('Game time:', gameTime, 'seconds');
  console.log('');
  
  // ゲーム開始の合図（フェーズ開始直後に1回だけ）
  console.log('📢 Game start horn');
  enqueueSound('other/horn.wav', 10);
  
  // 残り時間アナウンス（ブザー音 + remaining.wav + 時間）
  const timePoints = [
    { time: 1800, file: 'in-game/30min.wav' }, // 30分
    { time: 1200, file: 'in-game/20min.wav' }, // 20分
    { time: 900, file: 'in-game/15min.wav' },  // 15分
    { time: 600, file: 'in-game/10min.wav' },  // 10分
    { time: 300, file: 'in-game/5min.wav' },   // 5分
    { time: 180, file: 'in-game/3min.wav' },   // 3分
    { time: 120, file: 'in-game/2min.wav' },   // 2分
    { time: 60, file: 'in-game/60sec.wav' }    // 60秒
  ];
  
  timePoints.forEach(({ time, file }) => {
    // ゲーム開始直後のアナウンスを避けるため、
    // 「制限時間」と同じタイミング（time === gameTime）では再生しない
    if (gameTime > time) {
      console.log(`  - ${time}s remaining: buzzer + remaining + ${file}`);
      setSafeTimeout(() => {
        enqueueSound('other/buzzer_2times.wav', 10);
        enqueueSound('in-game/remaining.wav', 9);
        enqueueSound(file, 8);
      }, (gameTime - time) * 1000);
    }
  });
  
  // 10秒前（remaining.wav + 10sec.wav、ブザー音なし）
  // 実際の音声長とのズレを考慮して、タイマー上は残り8秒のタイミングで再生開始
  if (gameTime >= 12) {
    console.log(`  - 10 seconds remaining (adjusted): remaining + 10sec`);
    setSafeTimeout(() => {
      enqueueSound('in-game/remaining.wav', 10);
      enqueueSound('in-game/10sec.wav', 9);
    }, (gameTime - 8) * 1000);
  }
  
  // ゲーム終了（horn.wav）は削除
  // タイムアップ時はhandleGameEndでhorn.wavを再生するため、ここではスケジュールしない
  console.log('');
  console.log('📢 Game end: horn.wav will be played by handleGameEnd on timeout');
  
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

// ゲーム終了の音声（新しいファイル名に対応）
// ⑤終了フェーズ:
//   1) horn.wav（終了ホーン） - 既に再生済み（changePhaseラッパーで処理）
//   2) game_result.wav（ゲーム結果） - 既に再生済み（changePhaseラッパーで処理）
//   3) red_win.wav / yellow_win.wav / game_draw.wav（勝敗アナウンス） - 既に再生済み（changePhaseラッパーで処理）
//   4) game_end_safety.wavを3回再生（ただし、「新しいゲームボタン」が押されたら、再生停止、キュー削除で①待機フェーズに移行する）
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

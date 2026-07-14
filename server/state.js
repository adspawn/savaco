// サバゲー進行システム - 状態管理（SSOT）
// すべての状態はここで一元管理される

const audioQueue = require('./audioQueue');

// ゲーム選択肢の定義
const GAME_OPTIONS = {
  intervalTime: [5, 60, 120, 180, 300, 600, 900, 1200, 1800, 2400, 3000, 3600], // 5秒, 1-60分
  gameTime: [5, 60, 120, 180, 300, 600, 900, 1200, 1800, 2400, 3000, 3600],     // 5秒, 1-60分
  rules: ['フラッグ戦', '攻防戦', '無限復活戦'],
  options: ['1回復活', 'フルオート禁止'],
  positions: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z']
};

// マスターゲーム状態（SSOT）
let masterGameState = {
  phase: 'waiting', // waiting, interval, pre-game, in-game, game-over
  timer: {
    current: 0,           // 現在時間（秒）
    total: 0,             // 総時間（秒）
    isRunning: false,
    direction: 'down'     // 'down'=カウントダウン, 'up'=カウントアップ
  },
  settings: {
    intervalTime: null,   // 休憩時間（秒）
    rule: null,          // 'フラッグ戦', '攻防戦', '無限復活戦'
    gameTime: null,      // ゲーム時間（秒）
    options: [],         // ['1回復活', 'フルオート禁止']
    autoProgress: false, // 自動進行システム（両チーム準備完了時に自動開始）
    teams: {
      red: { position: null, ready: false },
      yellow: { position: null, ready: false }
    }
  },
  gameData: {
    redButtonCount: 0,    // 無限復活戦用
    yellowButtonCount: 0  // 無限復活戦用
  },
  result: {
    startTime: null,
    endTime: null,
    winner: null,         // 'red', 'yellow', 'draw', 'timeout'
    reason: null,         // 'flag', 'timeout', 'manual'
    redScore: 0,          // 無限復活戦用
    yellowScore: 0        // 無限復活戦用
  },
  audio: {
    queue: [],
    isPlaying: false,
    currentSound: null
  }
};

// タイマーインターバル
let timerInterval = null;

// 状態取得
function getState() {
  return masterGameState;
}

// 状態更新
function updateState(updates) {
  masterGameState = { ...masterGameState, ...updates };
  console.log('State updated:', updates);
}

// 設定更新
function updateSettings(settings) {
  masterGameState.settings = { ...masterGameState.settings, ...settings };
  console.log('Settings updated:', settings);
}

// フェーズ変更
function changePhase(newPhase) {
  masterGameState.phase = newPhase;
  console.log('Phase changed to:', newPhase);
  
  // フェーズ変更時の初期化処理
  switch(newPhase) {
    case 'waiting':
      resetTimer();
      resetGameData();
      break;
    case 'interval':
      setupIntervalTimer();
      break;
    case 'pre-game':
      setupPreGameTimer();
      break;
    case 'in-game':
      // in-gameフェーズではタイマーをすぐに開始
      setupGameTimer();
      break;
    case 'game-over':
      stopTimer();
      break;
  }
}

// タイマー設定・開始
function startTimer(totalSeconds, direction = 'down') {
  stopTimer(); // 既存のタイマーを停止
  
  masterGameState.timer = {
    current: direction === 'down' ? totalSeconds : 0,
    total: totalSeconds,
    isRunning: true,
    direction: direction
  };
  
  timerInterval = setInterval(() => {
    if (masterGameState.timer.direction === 'down') {
      masterGameState.timer.current--;
      console.log(`Timer countdown: ${masterGameState.timer.current}s remaining`);
      if (masterGameState.timer.current < 0) {
        masterGameState.timer.current = 0;
        masterGameState.timer.isRunning = false;
        clearInterval(timerInterval);
        console.log('Timer reached 0, calling handleTimerEnd');
        handleTimerEnd();
      }
    } else {
      masterGameState.timer.current++;
      console.log(`Timer countup: ${masterGameState.timer.current}s elapsed`);
    }
  }, 1000);
  
  console.log(`Timer started: ${totalSeconds}s, direction: ${direction}`);
}

// タイマー停止
function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  masterGameState.timer.isRunning = false;
}

// タイマーリセット
function resetTimer() {
  stopTimer();
  masterGameState.timer = {
    current: 0,
    total: 0,
    isRunning: false,
    direction: 'down'
  };
  console.log('Timer reset: current=0, total=0, isRunning=false, direction=down');
}

// ゲームデータリセット
function resetGameData() {
  masterGameState.gameData = {
    redButtonCount: 0,
    yellowButtonCount: 0
  };
  masterGameState.result = {
    startTime: null,
    endTime: null,
    winner: null,
    reason: null,
    redScore: 0,
    yellowScore: 0
  };
}

// 各フェーズのタイマー設定
function setupIntervalTimer() {
  if (masterGameState.settings.intervalTime) {
    startTimer(masterGameState.settings.intervalTime, 'down');
  }
}

function setupPreGameTimer() {
  startTimer(0, 'up'); // カウントアップ
}

function setupGameTimer() {
  console.log('setupGameTimer called');
  if (masterGameState.settings.gameTime) {
    console.log(`Starting game timer: ${masterGameState.settings.gameTime}s`);
    masterGameState.result.startTime = new Date().toISOString();
    startTimer(masterGameState.settings.gameTime, 'down');
  } else {
    console.warn('Cannot start game timer: gameTime not set');
  }
}

// タイマー終了時の処理
function handleTimerEnd() {
  console.log('Timer ended, current phase:', masterGameState.phase);
  switch(masterGameState.phase) {
    case 'interval':
      // 休憩終了 → ゲーム開始前へ
      console.log('Interval ended, changing to pre-game phase');
      changePhase('pre-game');
      console.log('Phase changed, new phase:', masterGameState.phase);
      // 強制的にブロードキャストをトリガー
      if (typeof global.broadcastGameState === 'function') {
        global.broadcastGameState();
      }
      break;
    case 'in-game':
      // ゲーム時間終了
      console.log('Game time ended');
      handleGameEnd('timeout');
      // 強制的にブロードキャストをトリガー
      if (typeof global.broadcastGameState === 'function') {
        console.log('Forcing broadcast after game timeout');
        setTimeout(() => {
          global.broadcastGameState();
        }, 100);
      }
      break;
  }
}

// ゲーム終了処理
function handleGameEnd(reason, winner = null) {
  console.log('handleGameEnd called, reason:', reason, 'winner:', winner);
  
  // ゲームが早期終了（フラッグ獲得など）した場合、残り時間のアナウンスをキャンセル
  if (reason !== 'timeout') {
    console.log('⚠️ Game ended early (not timeout) - clearing in-game audio schedules');
    audioQueue.clearAllSchedules(); // スケジュールされた音声をすべてキャンセル
    
    // フラッグ獲得終了時はhorn.wavを再生（キューはクリアしない）
    if (reason === 'flag') {
      console.log('📢 Playing horn.wav for flag capture');
      audioQueue.enqueueSound('other/horn.wav', 10);
    } else if (reason === 'manual') {
      // 手動終了時もhorn.wavを再生（キューはクリアしない）
      // 注意: endGameイベントで既にhorn.wavが再生されている可能性があるため、重複チェック
      const audioState = audioQueue.getAudioState();
      const hornIsPlaying = audioState.currentSound === 'other/horn.wav';
      const hornInQueue = audioState.queue && audioState.queue.some(item => item === 'other/horn.wav');
      if (!hornIsPlaying && !hornInQueue) {
        console.log('📢 Playing horn.wav for manual game end');
        audioQueue.enqueueSound('other/horn.wav', 10);
      } else {
        console.log('📢 horn.wav already playing or queued for manual game end');
      }
    } else {
      // フラッグ獲得・手動終了以外の早期終了の場合、キューをクリア
      audioQueue.clearQueue();
    }
  } else {
    // タイムアップ終了時もhorn.wavを再生
    console.log('⚠️ Game ended by timeout - clearing in-game audio schedules');
    audioQueue.clearAllSchedules();
    // 既にhorn.wavがキューにある場合は重複再生を避ける
    const audioState = audioQueue.getAudioState();
    const hornIsPlaying = audioState.currentSound === 'other/horn.wav';
    const hornInQueue = audioState.queue && audioState.queue.some(item => item === 'other/horn.wav');
    if (!hornIsPlaying && !hornInQueue) {
      console.log('📢 Playing horn.wav for timeout');
      audioQueue.enqueueSound('other/horn.wav', 10);
    } else {
      console.log('📢 horn.wav already playing or queued for timeout');
    }
  }
  
  masterGameState.result.endTime = new Date().toISOString();
  masterGameState.result.reason = reason;
  
  if (reason === 'timeout') {
    // 時間切れの場合は常に引き分け（game_draw）とする
    masterGameState.result.winner = 'draw';
  } else {
    // フラッグ獲得など、LoRa信号による終了時はwinnerをそのまま採用
    masterGameState.result.winner = winner;
  }
  
  masterGameState.result.redScore = masterGameState.gameData.redButtonCount;
  masterGameState.result.yellowScore = masterGameState.gameData.yellowButtonCount;
  
  console.log('Game result set:', masterGameState.result);
  
  // changePhaseを呼ぶ（socket.jsのラッパーが実行されるように、グローバルに設定されたchangePhaseを使う）
  // socket.jsでラップされたchangePhaseが実行されるように、グローバル変数経由で呼ぶ
  if (typeof global.changePhase === 'function') {
    global.changePhase('game-over');
  } else {
    changePhase('game-over');
  }
  console.log('Phase changed to game-over, current phase:', masterGameState.phase);
  
  // 強制的にブロードキャストをトリガー
  if (typeof global.broadcastGameState === 'function') {
    console.log('Forcing broadcast for game-over phase');
    global.broadcastGameState();
  }
}

// チーム準備完了トグル
function toggleTeamReady(team) {
  if (masterGameState.settings.teams[team]) {
    masterGameState.settings.teams[team].ready = !masterGameState.settings.teams[team].ready;
    console.log(`Team ${team} ready: ${masterGameState.settings.teams[team].ready}`);
    
    // 両チームが準備完了かチェック
    checkAutoGameStart();
  }
}

// 自動ゲーム開始チェック（socket.jsで処理するため無効化）
function checkAutoGameStart() {
  // socket.jsのtoggleTeamReadyイベントで両チーム準備完了時の処理を行う
  // ここでは何もしない
  return;
}

// ボタン押下処理（LoRa信号受信時）
function handleButtonPress(team) {
  if (masterGameState.phase === 'pre-game') {
    // 準備完了のトグル
    toggleTeamReady(team);
  } else if (masterGameState.phase === 'in-game') {
    if (masterGameState.settings.rule === '無限復活戦') {
      // 無限復活戦：カウント増加
      if (team === 'red') {
        masterGameState.gameData.redButtonCount++;
      } else {
        masterGameState.gameData.yellowButtonCount++;
      }
      console.log(`${team} button count: ${masterGameState.gameData[team + 'ButtonCount']}`);
    } else {
      // フラッグ戦・攻防戦：ゲーム終了
      const winner = team === 'red' ? 'red' : 'yellow';
      handleGameEnd('flag', winner);
    }
  }
}

// 設定の妥当性チェック
function validateSettings() {
  const { intervalTime, rule, gameTime, teams } = masterGameState.settings;
  return !!(intervalTime && rule && gameTime && teams.red.position && teams.yellow.position);
}

// チーム位置入れ替え
function swapTeamPositions() {
  const redPos = masterGameState.settings.teams.red.position;
  const yellowPos = masterGameState.settings.teams.yellow.position;
  
  masterGameState.settings.teams.red.position = yellowPos;
  masterGameState.settings.teams.yellow.position = redPos;
  
  console.log('Team positions swapped');
}

module.exports = {
  GAME_OPTIONS,
  getState,
  updateState,
  updateSettings,
  changePhase,
  startTimer,
  stopTimer,
  resetTimer,
  setupGameTimer,
  handleTimerEnd,
  handleGameEnd,
  toggleTeamReady,
  handleButtonPress,
  validateSettings,
  swapTeamPositions,
  checkAutoGameStart
};

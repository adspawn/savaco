// サバゲー進行システム - Socket.IO通信処理
// 管理画面・表示画面との通信を管理

const state = require('./state');
const audioQueue = require('./audioQueue');

// ゲーム開始処理中フラグ（連打防止）
let isGameStarting = false;

// 両チーム準備完了時、自動進行が有効ならルール説明→カウントダウン→ゲーム開始まで進める
// (準備完了トグルが管理画面UIとLoRaボタンのどちらから来ても同じ経路を通るよう共通化)
function scheduleAutoGameStart(settings) {
  if (isGameStarting) {
    console.log('⚠️ Game start already in progress, ignoring auto start');
    return;
  }

  isGameStarting = true;

  // all_ready.wavの再生完了を待ってから、ルール説明→start_countdown.wav→ゲーム開始
  // 既にコールバックが設定されている場合は、その後に追加する
  const currentCallback = audioQueue.getQueueCompleteCallback();
  audioQueue.setQueueCompleteCallback(() => {
    if (currentCallback) {
      currentCallback();
    }

    console.log('✅ all_ready.wav completed, starting rule explanation...');

    audioQueue.playRuleExplanationAndStart(settings, () => {
      console.log('✅ Start countdown completed');
      console.log('🎮 Transitioning to in-game phase...');

      state.changePhase('in-game');
      audioQueue.schedulePhaseAudio('in-game', settings);
      global.broadcastGameState();

      isGameStarting = false;
      console.log('✅ Auto game start process completed');
    }, true); // autoProgress = true
  });

  global.broadcastGameState();
}

// 準備完了トグル後の共通処理（管理画面UI・LoRaボタンの両方から呼ばれる）
// beforeToggle: トグル直前の { redReady, yellowReady }
function processTeamReadyChange(team, beforeToggle) {
  const updatedState = state.getState();
  const redReady = updatedState.settings.teams.red?.ready || false;
  const yellowReady = updatedState.settings.teams.yellow?.ready || false;

  // 準備完了/キャンセル音声の再生
  // 両チーム準備完了の処理は後で行うため、ここでは個別の音声のみ追加
  if (team === 'red') {
    if (redReady && !beforeToggle.redReady) {
      // OFF → ON: 準備完了音声
      audioQueue.enqueueSound('pre-game/red_ready.wav', 9);
    } else if (!redReady && beforeToggle.redReady) {
      // ON → OFF: キャンセル音声
      audioQueue.enqueueSound('pre-game/red_cancel.wav', 9);
    }
  }

  if (team === 'yellow') {
    if (yellowReady && !beforeToggle.yellowReady) {
      // OFF → ON: 準備完了音声
      audioQueue.enqueueSound('pre-game/yellow_ready.wav', 9);
    } else if (!yellowReady && beforeToggle.yellowReady) {
      // ON → OFF: キャンセル音声
      audioQueue.enqueueSound('pre-game/yellow_cancel.wav', 9);
    }
  }

  // 両チーム準備完了の処理（両方ONになった時のみ）
  // 両方とも既にONだった場合は何もしない（重複防止）
  const bothWereReady = beforeToggle.redReady && beforeToggle.yellowReady;
  const bothAreReady = redReady && yellowReady;

  if (bothAreReady && !bothWereReady) {
    // 両チームが準備完了になった（片方または両方がONになった）
    console.log('✅ Both teams ready!');

    // 重複実行を防ぐため、既にall_ready.wavがキューにあるかチェック
    const audioState = audioQueue.getAudioState();
    const currentQueue = audioState.queue || [];
    const currentSound = audioState.currentSound;
    const hasAllReady = currentQueue.some(item => item === 'pre-game/all_ready.wav') ||
                        currentSound === 'pre-game/all_ready.wav';

    if (hasAllReady) {
      console.log('⚠️ all_ready.wav already queued or playing, skipping duplicate registration');
      return;
    }

    // red_ready.wavとyellow_ready.wavがキューに含まれているか、現在再生中かチェック
    const hasRedReady = currentQueue.some(item => item === 'pre-game/red_ready.wav') ||
                        currentSound === 'pre-game/red_ready.wav';
    const hasYellowReady = currentQueue.some(item => item === 'pre-game/yellow_ready.wav') ||
                           currentSound === 'pre-game/yellow_ready.wav';

    // 両方の準備完了音声の再生完了を待ってから、all_ready.wavを再生
    // red_ready.wavとyellow_ready.wavの両方が完了したら、all_ready.wavを再生
    let redReadyCompleted = false;
    let yellowReadyCompleted = false;
    let allReadyPlayed = false; // 重複再生防止フラグ

    function checkAndPlayAllReady() {
      if (redReadyCompleted && yellowReadyCompleted && !allReadyPlayed) {
        allReadyPlayed = true; // フラグを立てて重複再生を防止
        console.log('✅ red_ready.wav and yellow_ready.wav completed, playing all_ready.wav');
        audioQueue.enqueueSound('pre-game/all_ready.wav', 10);
      }
    }

    // red_ready.wavの完了を待つ
    audioQueue.onSoundComplete('pre-game/red_ready.wav', () => {
      redReadyCompleted = true;
      console.log('✅ red_ready.wav completed');
      checkAndPlayAllReady();
    });

    // yellow_ready.wavの完了を待つ
    audioQueue.onSoundComplete('pre-game/yellow_ready.wav', () => {
      yellowReadyCompleted = true;
      console.log('✅ yellow_ready.wav completed');
      checkAndPlayAllReady();
    });

    // 既にキューに追加されているか、現在再生中かチェック
    // キューにない場合は、既に再生済みとみなす
    if (!hasRedReady) {
      // キューにない場合、既に再生済みとみなす
      redReadyCompleted = true;
      checkAndPlayAllReady();
    }
    // hasRedReadyがtrueの場合は、onSoundCompleteコールバックで完了を待つ

    if (!hasYellowReady) {
      // キューにない場合、既に再生済みとみなす
      yellowReadyCompleted = true;
      checkAndPlayAllReady();
    }
    // hasYellowReadyがtrueの場合は、onSoundCompleteコールバックで完了を待つ

    // 自動進行が有効な場合、all_ready.wavの後に自動的にゲームを開始
    if (updatedState.settings.autoProgress) {
      console.log('🚀 Auto progress enabled - will start game automatically after all_ready.wav...');
      scheduleAutoGameStart(updatedState.settings);
    } else {
      console.log('⏸️ Auto progress disabled - waiting for manual game start...');
    }
  } else if (!bothAreReady && bothWereReady) {
    // 両チーム準備完了から片方または両方がOFFになった場合、自動進行のコールバックをクリア
    if (isGameStarting) {
      console.log('⚠️ Team ready status changed - canceling auto start');
      isGameStarting = false;
      audioQueue.setQueueCompleteCallback(null);
    }
  }
}

// Socket.IOイベントハンドラーの設定
function setupSocketHandlers(io) {
  // 音声キューにSocket.IOインスタンスを設定
  audioQueue.setSocketIO(io);
  // 音声キューにstateモジュールを設定（両チーム準備完了チェック用）
  audioQueue.setStateModule(state);
  
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    // 接続時に現在の状態を送信
    socket.emit('gameStateUpdate', state.getState());
    
    // === 管理画面専用イベント ===
    
    // 管理画面として接続
    socket.on('joinAdmin', () => {
      socket.join('admin');
      console.log('Admin client joined:', socket.id);
      socket.emit('gameStateUpdate', state.getState());
    });
    
    // 表示画面として接続
    socket.on('joinDisplay', () => {
      socket.join('display');
      console.log('Display client joined:', socket.id);
      socket.emit('gameStateUpdate', state.getState());
    });
    
    // 設定更新
    socket.on('updateSettings', (settings) => {
      console.log('Settings update received:', settings);
      state.updateSettings(settings);
      broadcastGameState();
    });
    
    // チーム位置入れ替え
    socket.on('swapTeamPositions', () => {
      state.swapTeamPositions();
      broadcastGameState();
    });
    
    // 休憩開始
    socket.on('startInterval', () => {
      if (state.validateSettings()) {
        console.log('Starting interval phase');
        state.changePhase('interval');
        audioQueue.schedulePhaseAudio('interval', state.getState().settings);
        broadcastGameState();
      } else {
        socket.emit('error', { message: '設定が不完全です' });
      }
    });
    
    // 自動進行設定更新
    socket.on('updateAutoProgress', (data) => {
      const { enabled } = data;
      state.updateSettings({ autoProgress: enabled });
      console.log(`Auto progress ${enabled ? 'enabled' : 'disabled'}`);
      broadcastGameState();

      // 既に両チーム準備完了済みの状態でONにした場合も、そのままゲームを自動開始する
      // (ONにするタイミングが「両チーム準備完了」より後だと、トグル時の判定だけでは発火しないため)
      if (enabled) {
        const currentState = state.getState();
        if (currentState.phase === 'pre-game') {
          const redReady = currentState.settings.teams.red?.ready || false;
          const yellowReady = currentState.settings.teams.yellow?.ready || false;
          if (redReady && yellowReady && !isGameStarting) {
            console.log('🚀 Auto progress enabled while both teams already ready - starting now');
            scheduleAutoGameStart(currentState.settings);
          }
        }
      }
    });

    // チーム準備完了トグル
    socket.on('toggleTeamReady', (data) => {
      const { team } = data;
      const currentState = state.getState();
      if (currentState.phase === 'pre-game') {
        // トグル前の状態を保存
        const beforeToggle = {
          redReady: currentState.settings.teams.red?.ready || false,
          yellowReady: currentState.settings.teams.yellow?.ready || false
        };

        state.toggleTeamReady(team);
        broadcastGameState();

        // 両チーム準備完了チェック・自動進行判定
        // (LoRaボタン経由の準備完了トグルからも同じ処理を呼べるよう共通化してある)
        processTeamReadyChange(team, beforeToggle);
      }
    });
    
    // ゲーム開始（手動）
    socket.on('startGame', () => {
      const currentState = state.getState();
      
      // 連打防止：既に処理中の場合はスキップ
      if (isGameStarting) {
        console.log('⚠️ Game start already in progress, ignoring duplicate request');
        return;
      }
      
      if (currentState.phase === 'pre-game') {
        console.log('🎮 Manual game start requested');
        
        // 両チーム準備完了チェック
        const redReady = currentState.settings.teams.red?.ready || false;
        const yellowReady = currentState.settings.teams.yellow?.ready || false;
        
        if (!redReady || !yellowReady) {
          socket.emit('error', { message: '両チームの準備が完了していません' });
          return;
        }
        
        // 処理中フラグを立てる
        isGameStarting = true;
        console.log('🎯 Manual game start - stopping all audio and playing start countdown');

        // すべての再生を停止してキューを削除（これにより既存のonSoundCompleteコールバックもクリアされる）
        audioQueue.clearAllSchedules();
        audioQueue.clearQueue();

        // 「それではゲームを開始いたします、、、」を再生
        audioQueue.enqueueSound('pre-game/start_countdown.wav', 9);
        
        // start_countdown.wavの完了を待つ
        audioQueue.onSoundComplete('pre-game/start_countdown.wav', () => {
          console.log('✅ Start countdown completed');
          console.log('🎮 Transitioning to in-game phase...');
          
          // 処理中フラグをリセット（フェーズ変更前に）
          isGameStarting = false;
          
          state.changePhase('in-game');
          audioQueue.schedulePhaseAudio('in-game', currentState.settings);
          broadcastGameState();
          
          console.log('✅ Game start process completed');
        });
        
        // 現在の状態をブロードキャスト
        broadcastGameState();
        
      } else {
        socket.emit('error', { message: 'ゲーム開始は開始前フェーズでのみ可能です' });
      }
    });
    
    // ゲーム終了（手動）
    socket.on('endGame', () => {
      if (state.getState().phase === 'in-game') {
        console.log('Manual game end');

        // ゲーム終了処理（state.jsのhandleGameEndが終了アナウンスの再生も行う）
        state.handleGameEnd('manual', 'draw');
        broadcastGameState();
      }
    });
    
    // 休憩スキップ
    socket.on('skipInterval', () => {
      if (state.getState().phase === 'interval') {
        console.log('⏭️ Skipping interval - clearing all audio schedules');
        
        // すべての音声スケジュールとキューをクリア
        audioQueue.clearAllSchedules();
        audioQueue.clearQueue();
        
        // ③開始前フェーズに移行
        state.changePhase('pre-game');
        // schedulePhaseAudioは後でchangePhaseのラップ処理で呼ばれる
        broadcastGameState();
      }
    });
    
    // === 音声関連イベント ===
    
    // 音声再生完了通知
    socket.on('soundFinished', (data) => {
      console.log('Sound finished notification received', data);
      audioQueue.onSoundFinished(data && data.playbackId);
    });
    
    // 音声状態取得
    socket.on('getAudioState', () => {
      socket.emit('audioStateUpdate', audioQueue.getAudioState());
    });
    
    // === デバッグ用イベント ===
    
    // 状態リセット（新しいゲームボタン）
    socket.on('resetState', () => {
      console.log('State reset requested (new game button)');
      
      // ⑤終了フェーズから①待機フェーズに移行する場合、再生停止・キュー削除
      const currentState = state.getState();
      if (currentState.phase === 'game-over') {
        console.log('⚠️ Stopping all audio and clearing queue before transitioning to waiting phase');
        audioQueue.clearAllSchedules();
        audioQueue.clearQueue();
      }
      
      state.changePhase('waiting');
      audioQueue.schedulePhaseAudio('waiting');
      
      // ゲーム開始フラグをリセット
      isGameStarting = false;
      
      broadcastGameState();
    });
    
    // フェーズ強制変更（デバッグ用）
    socket.on('forcePhase', (data) => {
      const { phase } = data;
      console.log('Force phase change:', phase);
      state.changePhase(phase);
      broadcastGameState();
    });
    
    // 切断処理
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });
  
  // 全クライアントに状態をブロードキャスト
  function broadcastGameState() {
    const currentState = state.getState();
    io.emit('gameStateUpdate', currentState);
    console.log('Game state broadcasted, phase:', currentState.phase);
  }
  
  // グローバルに設定してstate.jsからアクセス可能にする
  global.broadcastGameState = broadcastGameState;
  
  // タイマー更新の定期送信
  setInterval(() => {
    const currentState = state.getState();
    if (currentState.timer.isRunning) {
      io.emit('timerUpdate', {
        current: currentState.timer.current,
        total: currentState.timer.total,
        direction: currentState.timer.direction,
        isRunning: currentState.timer.isRunning
      });
    }
  }, 1000);
  
  // フェーズ変更時の自動処理
  const originalChangePhase = state.changePhase;
  // グローバルに設定して、state.js内からもアクセス可能にする
  global.changePhase = function(newPhase) {
    return state.changePhase(newPhase);
  };
  state.changePhase = function(newPhase) {
    console.log('Phase change requested:', newPhase);
    
    // 元の関数を呼び出し
    const result = originalChangePhase.call(state, newPhase);
    console.log('Original changePhase called, current phase:', state.getState().phase);
    
    // 即座にブロードキャスト
    broadcastGameState();
    
    // フェーズ変更後の処理（即座に実行）
    const currentState = state.getState();
    console.log('Post-phase change processing for:', newPhase, 'actual phase:', currentState.phase);
    
    switch(newPhase) {
      case 'waiting':
        // 待機フェーズに戻る際は、音声スケジュールをクリア
        console.log('Waiting phase: scheduling (clears all)');
        audioQueue.schedulePhaseAudio('waiting');
        break;
        
      case 'pre-game':
        // 休憩終了後、準備完了をリセット
        console.log('Pre-game phase setup: resetting team ready status');
        state.updateSettings({
          teams: {
            red: { ...currentState.settings.teams.red, ready: false },
            yellow: { ...currentState.settings.teams.yellow, ready: false }
          }
        });
        audioQueue.schedulePhaseAudio('pre-game');
        break;
        
      case 'in-game':
        // ゲーム中フェーズ：音声スケジュールは既にstartGameイベントで設定済み
        console.log('In-game phase: audio already scheduled by startGame event');
        break;
        
      case 'game-over':
        // 終了アナウンス(game_end.wav / flag_captured.wav 等)は
        // state.js の handleGameEnd() が理由(timeout/flag/manual)に応じて再生済み。
        // 「新しいゲーム」ボタンが押されるまで自動的に待機フェーズには戻らない。
        console.log('Game over phase: ending announcement already handled by handleGameEnd()');
        break;
    }
    
    // 再度ブロードキャスト
    broadcastGameState();
    
    return result;
  };
  
  return { broadcastGameState };
}

module.exports = { setupSocketHandlers, processTeamReadyChange };

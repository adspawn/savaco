// サバゲー進行システム - Socket.IO通信処理
// 管理画面・表示画面との通信を管理

const state = require('./state');
const audioQueue = require('./audioQueue');

// ゲーム開始処理中フラグ（連打防止）
let isGameStarting = false;

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
      const currentState = state.getState();
      state.updateSettings({ autoProgress: enabled });
      console.log(`Auto progress ${enabled ? 'enabled' : 'disabled'}`);
      broadcastGameState();
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
        
        // 両チーム準備完了チェック
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
            
            // 連打防止：既に処理中の場合はスキップ
            if (isGameStarting) {
              console.log('⚠️ Game start already in progress, ignoring auto start');
              return;
            }
            
            // 処理中フラグを立てる
            isGameStarting = true;
            
            // all_ready.wavの再生完了を待ってから、ルール説明→start_countdown.wav→ゲーム開始
            // all_ready.wavの再生完了は音声キューで管理されるため、キュー完了コールバックを使用
            // ただし、既にコールバックが設定されている場合は、その後に追加する
            const currentCallback = audioQueue.getQueueCompleteCallback();
            audioQueue.setQueueCompleteCallback(() => {
              // 現在のコールバック（all_ready.wav再生）を実行
              if (currentCallback) {
                currentCallback();
              }
              
              // all_ready.wav完了後、ルール説明を開始
              console.log('✅ all_ready.wav completed, starting rule explanation...');
              
              // ルール説明を再生し、完了後にstart_countdown.wavを再生してin-gameフェーズへ
              audioQueue.playRuleExplanationAndStart(updatedState.settings, () => {
                // start_countdown.wav完了後、in-gameフェーズに移行
                console.log('✅ Start countdown completed');
                console.log('🎮 Transitioning to in-game phase...');
                
                state.changePhase('in-game');
                audioQueue.schedulePhaseAudio('in-game', updatedState.settings);
                broadcastGameState();
                
                // 処理完了後、フラグをリセット
                isGameStarting = false;
                console.log('✅ Auto game start process completed');
              }, true); // autoProgress = true
            });
            
            // 現在の状態をブロードキャスト
            broadcastGameState();
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
        console.log('🎯 Manual game start - stopping all audio and playing buzzer + start countdown');
        
        // すべての再生を停止してキューを削除（これにより既存のonSoundCompleteコールバックもクリアされる）
        audioQueue.clearAllSchedules();
        audioQueue.clearQueue();
        
        // buzzer_2times.wav + start_countdown.wav を再生
        audioQueue.enqueueSound('other/buzzer_2times.wav', 10);
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
        
        // すべての再生を停止してキューを削除
        audioQueue.clearAllSchedules();
        audioQueue.clearQueue();
        
        // horn.wavを再生（game_result.wavとgame_draw.wavはchangePhaseラッパーのgame-overケースで再生される）
        console.log('📢 Playing horn.wav for manual game end');
        audioQueue.enqueueSound('other/horn.wav', 10);
        
        // ゲーム終了処理（changePhase('game-over')が呼ばれ、game-overケースでgame_result.wavとgame_draw.wavが再生される）
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
        // ゲーム終了後、終了フェーズの音声がすべて再生されるまで待ってから待機に戻る
        console.log('Game over phase: scheduling game-over audio and delayed return to waiting');
        console.log('Current audio state:', JSON.stringify(audioQueue.getAudioState()));
        
          // horn.wavが再生中またはキューにある場合は、その完了を待ってから結果報告を再生
          const audioState = audioQueue.getAudioState();
          const hornIsPlaying = audioState.currentSound === 'other/horn.wav';
          const hornInQueue = audioState.queue && audioState.queue.some(item => item === 'other/horn.wav');
          
          console.log(`horn.wav check - playing: ${hornIsPlaying}, in queue: ${hornInQueue}`);
          
          function playGameResult() {
            console.log('Playing game result and winner announcement');
            const finalState = state.getState();
            
            // 既にgame_result.wavがキューにある場合は重複再生を避ける
            const currentQueue = audioQueue.getAudioState().queue || [];
            const hasGameResult = currentQueue.some(item => item === 'game-over/game_result.wav');
            
            if (!hasGameResult) {
              // game_result.wavを再生
              audioQueue.enqueueSound('game-over/game_result.wav', 9);
              
              // 勝敗アナウンスを再生
              let winnerSound = '';
              switch(finalState.result.winner) {
                case 'red':
                  winnerSound = 'game-over/red_win.wav';
                  audioQueue.enqueueSound(winnerSound, 8);
                  break;
                case 'yellow':
                  winnerSound = 'game-over/yellow_win.wav';
                  audioQueue.enqueueSound(winnerSound, 8);
                  break;
                case 'draw':
                default:
                  winnerSound = 'game-over/game_draw.wav';
                  audioQueue.enqueueSound(winnerSound, 8);
                  break;
              }
              
              // 勝敗アナウンスの完了を待ってから、game_end_safety.wavを3回再生
              audioQueue.onSoundComplete(winnerSound, () => {
                console.log('✅ Winner announcement completed, scheduling game_end_safety.wav (3 times)');
                audioQueue.scheduleGameOverAudio(finalState.result);
              });
            } else {
              console.log('⚠️ game_result.wav already queued, skipping duplicate');
            }
          }
          
          if (hornIsPlaying || hornInQueue) {
            console.log('Waiting for horn.wav to complete before playing game result');
            audioQueue.onSoundComplete('other/horn.wav', () => {
              console.log('✅ horn.wav completed, now playing game result');
              playGameResult();
            });
          } else {
            // horn.wavが既に完了しているか、再生されていない場合はすぐに結果報告を再生
            console.log('horn.wav not playing, playing game result immediately');
            playGameResult();
          }
          // 自動的に待機フェーズに戻らない（新しいゲームボタンを押すまで待機フェーズに移行しない）
          console.log('Game over phase: waiting for manual transition to waiting phase (new game button)');
          break;
    }
    
    // 再度ブロードキャスト
    broadcastGameState();
    
    return result;
  };
  
  return { broadcastGameState };
}

module.exports = { setupSocketHandlers };

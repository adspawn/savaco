// サバゲー進行システム - メインサーバー
// Express + Socket.IO + 静的ファイル配信

require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

// 自作モジュール
const { setupSocketHandlers } = require('./socket');
const lora = require('./lora');
const state = require('./state');
const audioQueue = require('./audioQueue');

// サーバー側重複防止用
const savedGameKeys = new Set();

// Express アプリケーション設定
const app = express();
const server = createServer(app);
const io = new Server(server);

// 環境変数
const PORT = process.env.PORT || 3000;
const SERIAL_PORT = process.env.SERIAL_PORT || 'COM3';

// 静的ファイル配信
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());

// ルート設定
app.get('/', (req, res) => {
  res.redirect('/admin/');
});

app.get('/admin', (req, res) => {
  res.redirect('/admin/');
});

app.get('/display', (req, res) => {
  res.redirect('/display/');
});

// API エンドポイント
app.get('/api/state', (req, res) => {
  res.json(state.getState());
});

app.get('/api/options', (req, res) => {
  res.json(state.GAME_OPTIONS);
});

app.get('/api/audio', (req, res) => {
  res.json(audioQueue.getAudioState());
});

app.get('/api/lora', (req, res) => {
  res.json(lora.getStats());
});

// リザルト保存エンドポイント
app.post('/api/result', (req, res) => {
  try {
    const result = req.body;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `result_${timestamp}.json`;
    const filepath = path.join(__dirname, '..', 'results', filename);

    // ゲームキーによる重複チェック
    const gameKey = `${result.result?.startTime}_${result.result?.endTime}`;

    console.log(`Result save request - Game: ${gameKey}`);

    // サーバー側重複チェック
    if (savedGameKeys.has(gameKey)) {
      console.log('DUPLICATE DETECTED ON SERVER - Rejecting request');
      return res.json({
        success: false,
        error: 'Duplicate game result',
        message: 'This game result has already been saved',
        gameKey: gameKey
      });
    }

    // resultsディレクトリが存在しない場合は作成
    const resultsDir = path.dirname(filepath);
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    fs.writeFileSync(filepath, JSON.stringify(result, null, 2));
    console.log('Result saved:', filename);

    savedGameKeys.add(gameKey);

    res.json({ success: true, filename });
  } catch (error) {
    console.error('Error saving result:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// リザルト一覧取得
app.get('/api/results', (req, res) => {
  try {
    const resultsDir = path.join(__dirname, '..', 'results');
    if (!fs.existsSync(resultsDir)) {
      return res.json([]);
    }

    const files = fs.readdirSync(resultsDir)
      .filter(file => file.endsWith('.json'))
      .map(file => {
        const filepath = path.join(resultsDir, file);
        const stats = fs.statSync(filepath);
        return {
          filename: file,
          created: stats.birthtime,
          size: stats.size
        };
      })
      .sort((a, b) => b.created - a.created);

    res.json(files);
  } catch (error) {
    console.error('Error listing results:', error);
    res.status(500).json({ error: error.message });
  }
});

// 特定のリザルト取得
app.get('/api/results/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filepath = path.join(__dirname, '..', 'results', filename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Result not found' });
    }

    const result = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    res.json(result);
  } catch (error) {
    console.error('Error reading result:', error);
    res.status(500).json({ error: error.message });
  }
});

// テスト用エンドポイント（実機なしでLoRa信号相当の動作を確認するデバッグ機能）
// body: { signalType, position: 'A'|'B'|'C'|'D' } または { signalType, positionId }
app.post('/api/test/lora', (req, res) => {
  const { signalType, position, positionId } = req.body;
  const resolvedPositionId = positionId || lora.getPositionId(position) || 0xA1;
  lora.sendTestSignal(signalType || 0x02, resolvedPositionId);
  res.json({ success: true, signalType, positionId: resolvedPositionId });
});

// Socket.IO設定
setupSocketHandlers(io);

// LoRa通信設定
lora.setSocketIO(io);

// サーバー起動
server.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('🎮 サバゲー進行システム 起動完了');
  console.log('='.repeat(50));
  console.log(`🌐 サーバー: http://localhost:${PORT}`);
  console.log(`👤 管理画面: http://localhost:${PORT}/admin/`);
  console.log(`📺 表示画面: http://localhost:${PORT}/display/`);
  console.log(`📡 UNIT-C6L ポート: ${SERIAL_PORT} (Meshtastic)`);
  console.log('='.repeat(50));

  // Meshtastic通信初期化
  if (process.env.NODE_ENV !== 'development') {
    console.log('🔗 Meshtastic通信を初期化中...');
    console.log('📡 利用可能なシリアルポートを確認中...');

    lora.listSerialPorts().then(() => {
      console.log(`🎯 接続先: ${SERIAL_PORT}`);
      lora.initializeSerial(SERIAL_PORT).then((success) => {
        if (success) {
          console.log('✅ Meshtastic通信初期化完了');
        } else {
          console.log('❌ Meshtastic通信初期化失敗（開発モードで継続）');
          console.log('💡 COM番号を確認してください');
        }
      });
    });
  } else {
    console.log('🔧 開発モード: Meshtastic通信はスキップ（管理画面のデバッグ信号で動作確認可能）');
  }

  console.log('='.repeat(50));
});

// 終了処理
function gracefulShutdown() {
  console.log('\n🛑 サーバーを終了中...');

  // タイマーを停止
  state.stopTimer();

  // 音声キューとスケジュールをクリア
  audioQueue.clearAllSchedules();
  audioQueue.clearQueue();

  // Meshtastic通信を閉じる
  Promise.resolve(lora.closeSerial()).catch((error) => {
    console.error('Meshtastic close error:', error.message);
  });

  // サーバーを閉じる
  server.close(() => {
    console.log('✅ サーバー終了完了');
    process.exit(0);
  });

  // 強制終了タイムアウト（10秒後に強制終了）
  setTimeout(() => {
    console.error('⚠️ 強制終了: タイムアウト');
    process.exit(1);
  }, 10000);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

module.exports = { app, server, io };

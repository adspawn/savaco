// サバゲー進行システム - LoRa通信処理
// UNIT-C6L (Meshtastic / SX1262) USB 受信
//
// 信号仕様 (v2: 短押し/長押し):
//   送信デバイスは Meshtastic の Detection Sensor 通知しか送れない(1ビット)ため、
//   「パルス回数」で押し方を表現する。
//     - 短押し (0.8秒以内リリース) : G4パルス 1回
//     - 長押し (10秒保持)          : G4パルス 2回 (約3秒間隔)
//   受信側は1回目のパルスを受けたら確定を保留し、判定ウィンドウ内に
//   2回目が届けば「長押し」、届かなければ「短押し」として確定する。
//
//   フェーズ×ルールによる解釈:
//     短押し: 開始前=準備完了トグル / ゲーム中(無限復活戦)=復活カウント / それ以外=無視
//     長押し: ゲーム中(フラッグ戦・攻防戦)=フラッグ獲得(ゲーム終了) /
//             ゲーム中(無限復活戦)=復活カウント / 開始前=準備完了トグル / それ以外=無視

const { SerialPort } = require('serialport');
const state = require('./state');

let io = null;
let meshtasticConnection = null;
let portPath = null;

// 信号種別
const SIGNAL_READY = 0x01; // 旧互換: 明示的な準備完了
const SIGNAL_SHORT = 0x02; // 短押し
const SIGNAL_LONG = 0x03;  // 長押し

const POSITION_IDS = {
  A: 0xA1,
  B: 0xB1,
  C: 0xC1,
  D: 0xD1
};

// 1回目のパルス受信後、2回目を待つ判定ウィンドウ (ms)
// ESP32側は長押し時に約3秒間隔でパルスを2回送るため、余裕をみて4.5秒
const LONG_PRESS_WINDOW_MS = parseInt(process.env.LORA_LONG_PRESS_WINDOW_MS, 10) || 4500;

// 保留中の押下 (positionId -> { timer, meta })
const pendingPresses = new Map();

function setSocketIO(socketIO) {
  io = socketIO;
}

function parseNodeMap() {
  const raw = process.env.LORA_NODE_MAP;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn('LORA_NODE_MAP の JSON 解析に失敗:', error.message);
    return {};
  }
}

function parsePositionFromText(text) {
  if (!text) return null;

  const patterns = [
    /BUTTON_([A-D])_/i,
    /POSITION_([A-D])/i,
    /_([A-D])\s+detected/i,
    /\b([A-D])\s*detected/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }

  if (/BUTTON_ON/i.test(text) || /detected/i.test(text)) {
    return (process.env.LORA_DEFAULT_POSITION || 'A').toUpperCase();
  }

  return null;
}

function parsePositionFromNode(fromNode, nodeMap) {
  const keys = [
    String(fromNode),
    `!${fromNode.toString(16)}`,
    `!${fromNode.toString(16).padStart(8, '0')}`
  ];

  for (const key of keys) {
    if (nodeMap[key]) {
      return nodeMap[key].toUpperCase();
    }
  }

  return null;
}

function positionNameToId(positionName) {
  return POSITION_IDS[positionName] || null;
}

function resolvePosition(fromNode, text) {
  const nodeMap = parseNodeMap();
  return (
    parsePositionFromNode(fromNode, nodeMap) ||
    parsePositionFromText(text) ||
    (process.env.LORA_DEFAULT_POSITION || 'A').toUpperCase()
  );
}

async function initializeSerial(portName = 'COM3') {
  portPath = portName;

  try {
    const { startMeshtasticBridge } = await import('./meshtasticBridge.mjs');

    meshtasticConnection = await startMeshtasticBridge(portName, (packet) => {
      console.log(
        `Meshtastic packet from=${packet.from} port=${packet.portnum} text=${packet.text}`
      );
      handleMeshtasticPacket(packet);
    });

    return true;
  } catch (error) {
    console.error('Failed to initialize Meshtastic serial:', error.message);
    meshtasticConnection = null;
    return false;
  }
}

function handleMeshtasticPacket(packet) {
  const positionName = resolvePosition(packet.from, packet.text);
  const positionId = positionNameToId(positionName);

  if (!positionId) {
    console.warn(`Unknown position name: ${positionName}`);
    return;
  }

  registerPulse(positionId, {
    source: 'meshtastic',
    fromNode: packet.from,
    text: packet.text,
    portnum: packet.portnum
  });
}

// パルスを1回受信 → 短押し/長押しの判定ウィンドウ処理
function registerPulse(positionId, meta = {}) {
  const positionName = getPositionName(positionId);
  const pending = pendingPresses.get(positionId);

  if (pending) {
    // ウィンドウ内に2回目のパルス → 長押し確定 (即時)
    clearTimeout(pending.timer);
    pendingPresses.delete(positionId);
    console.log(`Pulse #2 within window -> LONG press confirmed (position ${positionName})`);
    processLoRaSignal(SIGNAL_LONG, positionId, meta);
    return;
  }

  // 1回目のパルス → ウィンドウ満了まで確定を保留
  console.log(
    `Pulse #1 received (position ${positionName}) -> waiting ${LONG_PRESS_WINDOW_MS}ms for pulse #2`
  );

  if (io) {
    io.emit('loraPending', {
      positionId,
      position: positionName,
      windowMs: LONG_PRESS_WINDOW_MS
    });
  }

  const timer = setTimeout(() => {
    pendingPresses.delete(positionId);
    console.log(`Window elapsed with single pulse -> SHORT press confirmed (position ${positionName})`);
    processLoRaSignal(SIGNAL_SHORT, positionId, meta);
  }, LONG_PRESS_WINDOW_MS);

  pendingPresses.set(positionId, { timer, meta });
}

function clearPendingPresses() {
  for (const pending of pendingPresses.values()) {
    clearTimeout(pending.timer);
  }
  pendingPresses.clear();
}

function processLoRaSignal(signalType, positionId, meta = {}) {
  console.log(
    `LoRa signal - Type: 0x${signalType.toString(16).padStart(2, '0')}, Position: 0x${positionId.toString(16).padStart(2, '0')}`
  );

  const team = getTeamFromPosition(positionId);
  if (!team) {
    console.warn('Unknown position ID:', positionId);
    return;
  }

  console.log(`Position 0x${positionId.toString(16).padStart(2, '0')} mapped to team: ${team}`);

  const currentState = state.getState();
  const phase = currentState.phase;
  console.log(`Current phase: ${phase}`);

  let action = 'ignored';
  switch (signalType) {
    case SIGNAL_READY:
      action = handleReadyToggle(team, phase);
      break;
    case SIGNAL_SHORT:
      action = handleShortPress(team, phase);
      break;
    case SIGNAL_LONG:
      action = handleLongPress(team, phase);
      break;
    default:
      console.warn('Unknown signal type:', signalType);
      return;
  }

  console.log(`Signal resolved to action: ${action}`);

  if (io) {
    io.emit('gameStateUpdate', state.getState());
    io.emit('loraSignal', {
      signalType,
      positionId,
      team,
      position: getPositionName(positionId),
      phase,
      action,
      ...meta
    });
  }
}

// 準備完了トグル (開始前フェーズのみ有効)
function handleReadyToggle(team, phase) {
  if (phase !== 'pre-game') {
    console.log(`Ready signal ignored - current phase: ${phase}`);
    return 'ignored';
  }

  state.toggleTeamReady(team);
  const isReady = state.getState().settings.teams[team].ready;
  console.log(`Team ${team} ready toggled -> ${isReady}`);
  return isReady ? 'ready-on' : 'ready-off';
}

// 短押し: 開始前=準備完了 / ゲーム中(無限復活戦)=復活カウント / それ以外=無視
function handleShortPress(team, phase) {
  switch (phase) {
    case 'pre-game':
      return handleReadyToggle(team, phase);

    case 'in-game': {
      const rule = state.getState().settings.rule;
      if (rule === '無限復活戦') {
        state.handleButtonPress(team);
        console.log(`Short press -> respawn count for ${team}`);
        return 'respawn';
      }
      // フラッグ戦・攻防戦では短押しは無効 (誤タップでゲームが終わる事故を防ぐ)
      console.log(`Short press ignored in rule "${rule}" (long press required for flag capture)`);
      return 'ignored';
    }

    default:
      console.log(`Short press ignored in phase: ${phase}`);
      return 'ignored';
  }
}

// 長押し: ゲーム中(フラッグ戦・攻防戦)=フラッグ獲得 /
//         ゲーム中(無限復活戦)=復活カウント / 開始前=準備完了 / それ以外=無視
function handleLongPress(team, phase) {
  switch (phase) {
    case 'pre-game':
      return handleReadyToggle(team, phase);

    case 'in-game': {
      const rule = state.getState().settings.rule;
      if (rule === '無限復活戦') {
        state.handleButtonPress(team);
        console.log(`Long press -> respawn count for ${team} (no flag in this rule)`);
        return 'respawn';
      }
      console.log(`Long press -> FLAG CAPTURE by ${team}`);
      state.handleButtonPress(team); // フラッグ戦・攻防戦ではゲーム終了処理が走る
      return 'flag-capture';
    }

    default:
      console.log(`Long press ignored in phase: ${phase}`);
      return 'ignored';
  }
}

function getTeamFromPosition(positionId) {
  const currentState = state.getState();
  const settings = currentState.settings;
  const positionName = getPositionName(positionId);

  if (!positionName) {
    return null;
  }

  if (settings.teams.red.position === positionName) {
    return 'red';
  }
  if (settings.teams.yellow.position === positionName) {
    return 'yellow';
  }

  console.warn(`Position ${positionName} is not assigned to any team`);
  return null;
}

function getPositionName(positionId) {
  switch (positionId) {
    case 0xA1: return 'A';
    case 0xB1: return 'B';
    case 0xC1: return 'C';
    case 0xD1: return 'D';
    default: return null;
  }
}

async function closeSerial() {
  clearPendingPresses();

  if (meshtasticConnection) {
    try {
      await meshtasticConnection.close();
      console.log('Meshtastic connection closed successfully');
    } catch (error) {
      console.error('Error closing Meshtastic connection:', error.message);
    }
    meshtasticConnection = null;
  }
}

async function listSerialPorts() {
  try {
    const ports = await SerialPort.list();
    console.log('Available serial ports:');
    ports.forEach((port) => {
      console.log(`  ${port.path} - ${port.manufacturer || port.friendlyName || 'Unknown'}`);
    });
    return ports;
  } catch (error) {
    console.error('Error listing serial ports:', error);
    return [];
  }
}

// テスト用: 位置名 ('A'-'D') から positionId を取得（デバッグ画面から使用）
function getPositionId(positionName) {
  if (!positionName) return null;
  return positionNameToId(positionName.toUpperCase());
}

// テスト用: 判定済みの信号を直接注入 (短押し/長押しを明示指定)
function sendTestSignal(signalType, positionId) {
  console.log(
    `Sending test signal: Type=0x${signalType.toString(16).padStart(2, '0')}, Position=0x${positionId.toString(16).padStart(2, '0')}`
  );
  processLoRaSignal(signalType, positionId, { source: 'test' });
}

// テスト用: 生のパルス1回を注入 (実機と同じ判定ウィンドウを通す)
// 1回呼べば短押し、ウィンドウ内に2回呼べば長押しとして判定される
function simulatePulse(positionId) {
  console.log(
    `Simulating raw pulse: Position=0x${positionId.toString(16).padStart(2, '0')}`
  );
  registerPulse(positionId, { source: 'test-pulse' });
}

function isConnected() {
  return Boolean(meshtasticConnection);
}

function getStats() {
  return {
    isConnected: isConnected(),
    portPath: meshtasticConnection ? meshtasticConnection.path : portPath,
    baudRate: meshtasticConnection ? meshtasticConnection.baudRate : 115200,
    mode: 'meshtastic',
    longPressWindowMs: LONG_PRESS_WINDOW_MS
  };
}

module.exports = {
  setSocketIO,
  initializeSerial,
  processLoRaSignal,
  closeSerial,
  listSerialPorts,
  getPositionId,
  sendTestSignal,
  simulatePulse,
  isConnected,
  getStats
};

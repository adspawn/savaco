// サバゲー進行システム - LoRa通信処理
// UNIT-C6L (Meshtastic / SX1262) USB 受信
// ボタン押下でシリアルに届くテキストを受信してゲーム進行に反映するだけ。
// LoRa送信側のプロトコル実装はこちら側には不要（Meshtasticユニットが担う）。

const { SerialPort } = require('serialport');
const state = require('./state');

let io = null;
let meshtasticConnection = null;
let portPath = null;

const POSITION_IDS = {
  A: 0xA1,
  B: 0xB1,
  C: 0xC1,
  D: 0xD1
};

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

  // Detection Sensor はボタン押下相当 (フェーズで ready / button を切り替え)
  processLoRaSignal(0x02, positionId, {
    source: 'meshtastic',
    fromNode: packet.from,
    text: packet.text,
    portnum: packet.portnum
  });
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
  console.log(`Current phase: ${currentState.phase}`);

  switch (signalType) {
    case 0x01:
      handleReadySignal(team);
      break;
    case 0x02:
      handleButtonSignalByPhase(team, currentState.phase);
      break;
    default:
      console.warn('Unknown signal type:', signalType);
      return;
  }

  if (io) {
    io.emit('gameStateUpdate', state.getState());
    io.emit('loraSignal', {
      signalType,
      positionId,
      team,
      position: getPositionName(positionId),
      phase: currentState.phase,
      ...meta
    });
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

function handleButtonSignalByPhase(team, phase) {
  console.log(`Processing button signal from ${team} team in phase: ${phase}`);

  switch (phase) {
    case 'pre-game':
      console.log(`Button signal interpreted as READY signal for ${team} team`);
      handleReadySignal(team);
      break;
    case 'in-game':
      console.log(`Button signal interpreted as BUTTON signal for ${team} team`);
      handleButtonSignal(team);
      break;
    default:
      console.log(`Button signal ignored in phase: ${phase}`);
      break;
  }
}

function handleReadySignal(team) {
  const currentState = state.getState();

  if (currentState.phase === 'pre-game') {
    console.log(`Ready signal from ${team} team`);
    state.toggleTeamReady(team);
  } else {
    console.log(`Ready signal ignored - current phase: ${currentState.phase}`);
  }
}

function handleButtonSignal(team) {
  const currentState = state.getState();

  if (currentState.phase === 'in-game') {
    console.log(`Button signal from ${team} team in game phase`);
    state.handleButtonPress(team);

    if (currentState.settings.rule !== '無限復活戦') {
      console.log(`Game ended by ${team} team flag capture`);
    }
  } else {
    console.log(`Button signal ignored - current phase: ${currentState.phase}`);
  }
}

async function closeSerial() {
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

function sendTestSignal(signalType, positionId) {
  console.log(
    `Sending test signal: Type=0x${signalType.toString(16).padStart(2, '0')}, Position=0x${positionId.toString(16).padStart(2, '0')}`
  );
  processLoRaSignal(signalType, positionId, { source: 'test' });
}

function isConnected() {
  return Boolean(meshtasticConnection);
}

function getStats() {
  return {
    isConnected: isConnected(),
    portPath: meshtasticConnection ? meshtasticConnection.path : portPath,
    baudRate: meshtasticConnection ? meshtasticConnection.baudRate : 115200,
    mode: 'meshtastic'
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
  isConnected,
  getStats
};

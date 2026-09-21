// サバゲー進行システム - LoRa通信処理
// UNIT-C6L (Meshtastic / SX1262) USB 受信
//
// 信号仕様 (v3: 文字列): Meshtastic の Serial Module (TEXTMSG) で ESP32 が確定結果を直接送る
//   受信する本文は TEXT_MESSAGE_APP で「種別[:ポジション][:秒数][#連番]」の形式:
//     SHORT / SHORT:A     短押し (ESP32側で判定済み。判定ウィンドウ待ちなし)
//     LONG  / LONG:A      長押し (10秒保持の確定時に1通)
//     CANCEL:A:4.2        途中で離した (記録のみ。ゲームには影響しない)
//   ポジションは LORA_NODE_MAP (ノードID -> ポジション) を最優先で決める。
//   1つのポジションに複数のノードを割り当てれば冗長化できる。
//   ノードが未登録のときだけ、本文中のポジション (SHORT:A の A) を使う。
//
// 信号仕様 (v2: 短押し/長押し) ※旧Detection Sensor方式。未移行の送信機のために残している:
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

const fs = require('fs');
const path = require('path');
const { SerialPort } = require('serialport');
const state = require('./state');
const { processTeamReadyChange } = require('./socket');

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
  D: 0xD1,
  E: 0xE1
};

// 1回目のパルス受信後、2回目を待つ判定ウィンドウ (ms)
// ESP32側は長押し時に約3秒間隔でパルスを2回送るため、余裕をみて4.5秒
const LONG_PRESS_WINDOW_MS = parseInt(process.env.LORA_LONG_PRESS_WINDOW_MS, 10) || 4500;

// 判定確定後、同ポジションのパルスを無視するロックアウト時間 (ms)
// Detection Sensorの「こだま」(1回のパルスに対する遅延した二重発報)が
// 新しい判定ウィンドウを開いて誤検知するのを防ぐ
const PULSE_LOCKOUT_MS = parseInt(process.env.LORA_PULSE_LOCKOUT_MS, 10) || 2500;

// 文字列方式: 同一ポジション・同一種別の重複を1回にまとめる期間 (ms)
// 同じポジションに複数の送信機を割り当てた場合の二重処理 (準備完了トグルが二重でOFFに戻る等) を防ぐ
const TEXT_DEDUP_MS = parseInt(process.env.LORA_TEXT_DEDUP_MS, 10) || 3000;

// 直近に処理した文字列信号 (`${positionId}:${kind}` -> timestamp)
const recentTextSignals = new Map();

// 保留中の押下 (positionId -> { timer, meta })
const pendingPresses = new Map();

// ロックアウト期限 (positionId -> timestamp)
const lockoutUntil = new Map();

function setSocketIO(socketIO) {
  io = socketIO;
}

// ノードID -> ポジション の対応表
//   優先順位: 管理画面で保存した対応表 (data/lora-node-map.json) > .env の LORA_NODE_MAP
//   1つのポジションに複数のノードを割り当ててよい (冗長化)
const NODE_MAP_FILE = process.env.LORA_NODE_MAP_FILE || path.join(__dirname, '..', 'data', 'lora-node-map.json');
const POSITION_NAMES = Object.keys(POSITION_IDS);

// 受信した送信機の一覧 (管理画面で未登録ノードを見つけて割り当てるため) shortId -> 情報
const seenNodes = new Map();

// ノードIDの正規化: "c414" / "!f115c414" / "F115C414" -> 大文字。4桁(短縮ID)か8桁(フルID)のみ許可
function normalizeNodeKey(key) {
  const k = String(key).trim().replace(/^!/, '').toUpperCase();
  if (!/^([0-9A-F]{4}|[0-9A-F]{8})$/.test(k)) {
    throw new Error(`ノードID "${key}" が不正です (16進数4桁 例: C414)`);
  }
  return k;
}

// 対応表の検証・正規化。不正なら例外 (保存前に必ず通す)
function normalizeNodeMap(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('対応表はオブジェクトで指定してください');
  }
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    const position = String(value).trim().toUpperCase();
    if (!POSITION_NAMES.includes(position)) {
      throw new Error(`ポジション "${value}" が不正です (${POSITION_NAMES.join('/')})`);
    }
    result[normalizeNodeKey(key)] = position;
  }
  return result;
}

function parseEnvNodeMap() {
  const raw = process.env.LORA_NODE_MAP;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn('LORA_NODE_MAP の JSON 解析に失敗:', error.message);
    return {};
  }
}

function loadSavedNodeMap() {
  try {
    return normalizeNodeMap(JSON.parse(fs.readFileSync(NODE_MAP_FILE, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`保存済みの対応表を読めないため .env を使用します (${NODE_MAP_FILE}):`, error.message);
    }
    return null;
  }
}

let savedNodeMap = loadSavedNodeMap(); // null = 未保存 (.env を使用)

function parseNodeMap() {
  return savedNodeMap || parseEnvNodeMap();
}

function shortNodeId(fromNode) {
  return fromNode.toString(16).padStart(8, '0').slice(-4).toUpperCase();
}

function recordSeenNode(packet) {
  const shortId = shortNodeId(packet.from);
  const previous = seenNodes.get(shortId);
  seenNodes.set(shortId, {
    shortId,
    lastSeen: Date.now(),
    lastText: packet.text,
    portnum: packet.portnum,
    rssi: packet.rssi,
    snr: packet.snr,
    count: (previous ? previous.count : 0) + 1
  });
}

// 管理画面向け: 現在の対応表・受信済みノード・ポジション一覧
function getNodeInfo() {
  return {
    nodeMap: parseNodeMap(),
    source: savedNodeMap ? 'saved' : 'env',
    positions: POSITION_NAMES,
    seenNodes: [...seenNodes.values()].sort((a, b) => b.lastSeen - a.lastSeen)
  };
}

function emitNodeInfo() {
  if (io) io.emit('loraNodes', getNodeInfo());
}

// 対応表を保存 (検証 -> ファイル書き込み -> 反映)。不正な入力は例外で拒否し、既存の対応表は変えない
function setNodeMap(input) {
  const normalized = normalizeNodeMap(input);
  fs.mkdirSync(path.dirname(NODE_MAP_FILE), { recursive: true });
  const tmp = `${NODE_MAP_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2));
  fs.renameSync(tmp, NODE_MAP_FILE); // 書き込み途中の破損を避ける
  savedNodeMap = normalized;
  console.log('LoRa node map saved:', JSON.stringify(normalized));
  emitNodeInfo();
  return getNodeInfo();
}

// 保存した対応表を破棄して .env の LORA_NODE_MAP に戻す
function resetNodeMap() {
  try {
    fs.unlinkSync(NODE_MAP_FILE);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  savedNodeMap = null;
  console.log('LoRa node map reset to .env');
  emitNodeInfo();
  return getNodeInfo();
}

function parsePositionFromText(text) {
  if (!text) return null;

  const patterns = [
    /BUTTON_([A-E])_/i,
    /POSITION_([A-E])/i,
    /_([A-E])\s+detected/i,
    /\b([A-E])\s*detected/i
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
  const hex8 = fromNode.toString(16).padStart(8, '0');
  const shortId = hex8.slice(-4).toUpperCase(); // Meshtasticの短縮ノードID表記 (例: D0E4)

  const keys = [
    String(fromNode),
    `!${fromNode.toString(16)}`,
    `!${hex8}`,
    hex8, // 管理画面で保存する8桁形式 (! なし)
    shortId,
    `!${shortId}`
  ];

  // LORA_NODE_MAP のキーは大文字小文字を区別せずマッチさせる
  const normalizedMap = {};
  for (const [key, value] of Object.entries(nodeMap)) {
    normalizedMap[key.toUpperCase()] = value;
  }

  for (const key of keys) {
    const match = normalizedMap[key.toUpperCase()];
    if (match) {
      return match.toUpperCase();
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
        `Meshtastic packet from=${packet.from} port=${packet.portnum} text=${packet.text}` +
        (packet.rssi !== undefined ? ` rssi=${packet.rssi}dBm snr=${packet.snr}dB` : '')
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

// 文字列方式の本文を解釈する
// 例: "SHORT:A#5" -> { kind: 'SHORT', position: 'A' } / "CANCEL:A:4.2" -> { kind: 'CANCEL', position: 'A', seconds: 4.2 }
// ボタン信号でない本文 (通常のチャット等) は null
function parseButtonMessage(text) {
  if (!text) return null;
  const [body] = text.trim().split('#'); // "#連番" は遅延計測用。本番では付かない
  const [rawKind, ...rest] = body.split(':').map((part) => part.trim());
  const kind = rawKind.toUpperCase();
  if (kind !== 'SHORT' && kind !== 'LONG' && kind !== 'CANCEL') return null;

  const message = { kind };
  for (const part of rest) {
    if (/^[A-E]$/i.test(part)) {
      message.position = part.toUpperCase();
    } else if (/^\d+(\.\d+)?$/.test(part)) {
      message.seconds = parseFloat(part);
    } else if (part !== '') {
      return null; // 想定外の形式は誤動作を避けて無視
    }
  }
  return message;
}

// 文字列方式 (TEXT_MESSAGE_APP) の処理。判定ウィンドウは不要で、届いた時点で確定として扱う
function handleTextPacket(packet) {
  const message = parseButtonMessage(packet.text);
  if (!message) {
    console.log(`Text message ignored (not a button signal): "${packet.text}"`);
    return;
  }

  // ポジションはサーバー側の対応表 (ノードID -> ポジション) が最優先
  const positionName =
    parsePositionFromNode(packet.from, parseNodeMap()) || message.position || null;
  if (!positionName) {
    console.warn(
      `Button signal from unmapped node ${packet.from.toString(16)} with no position in text: "${packet.text}"`
    );
    return;
  }

  const positionId = positionNameToId(positionName);
  if (!positionId) {
    console.warn(`Unknown position name: ${positionName}`);
    return;
  }

  if (message.kind === 'CANCEL') {
    console.log(
      `Button cancelled (position ${positionName}, held ${message.seconds ?? '?'}s) - no action`
    );
    return;
  }

  // 同一ポジション・同一種別の重複 (複数の送信機を割り当てた場合など) は1回にまとめる
  const dedupKey = `${positionId}:${message.kind}`;
  const now = Date.now();
  const last = recentTextSignals.get(dedupKey) || 0;
  if (now - last < TEXT_DEDUP_MS) {
    console.log(
      `Duplicate ${message.kind} for position ${positionName} ignored (${now - last}ms after previous)`
    );
    return;
  }
  recentTextSignals.set(dedupKey, now);

  processLoRaSignal(message.kind === 'LONG' ? SIGNAL_LONG : SIGNAL_SHORT, positionId, {
    source: 'meshtastic-text',
    fromNode: packet.from,
    text: packet.text,
    portnum: packet.portnum,
    rssi: packet.rssi,
    snr: packet.snr
  });
}

function handleMeshtasticPacket(packet) {
  recordSeenNode(packet);
  emitNodeInfo();

  // 文字列方式: ボタン信号として解釈できる本文だけ処理する
  // (通常のチャット文を旧方式の「パルス1回」と誤認しないよう、旧方式の処理には流さない)
  if (packet.portnum === 'TEXT_MESSAGE_APP') {
    handleTextPacket(packet);
    return;
  }

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
    portnum: packet.portnum,
    rssi: packet.rssi,
    snr: packet.snr
  });
}

// パルスを1回受信 → 短押し/長押しの判定ウィンドウ処理
function registerPulse(positionId, meta = {}) {
  const positionName = getPositionName(positionId);
  const now = Date.now();

  // 判定確定直後のロックアウト中は無視 (Detection Sensorのこだま対策)
  const lockedUntil = lockoutUntil.get(positionId) || 0;
  if (now < lockedUntil) {
    console.log(
      `Pulse ignored - lockout active for ${lockedUntil - now}ms more (position ${positionName})`
    );
    return;
  }

  const pending = pendingPresses.get(positionId);

  if (pending) {
    // ウィンドウ内に2回目のパルス → 長押し確定 (即時)
    clearTimeout(pending.timer);
    pendingPresses.delete(positionId);
    lockoutUntil.set(positionId, Date.now() + PULSE_LOCKOUT_MS);
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
      windowMs: LONG_PRESS_WINDOW_MS,
      rssi: meta.rssi,
      snr: meta.snr
    });
  }

  const timer = setTimeout(() => {
    pendingPresses.delete(positionId);
    lockoutUntil.set(positionId, Date.now() + PULSE_LOCKOUT_MS);
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
  lockoutUntil.clear();
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

  const beforeState = state.getState();
  const beforeToggle = {
    redReady: beforeState.settings.teams.red?.ready || false,
    yellowReady: beforeState.settings.teams.yellow?.ready || false
  };

  state.toggleTeamReady(team);
  const isReady = state.getState().settings.teams[team].ready;
  console.log(`Team ${team} ready toggled -> ${isReady}`);

  // 両チーム準備完了チェック・自動進行判定
  // (管理画面UIのtoggleTeamReadyイベントと同じ処理を通す。
  //  これを呼ばないと、LoRaボタンでの準備完了は「自動進行」が一切発火しない)
  processTeamReadyChange(team, beforeToggle);

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
    case 0xE1: return 'E';
    default: return null;
  }
}

async function closeSerial() {
  clearPendingPresses();
  recentTextSignals.clear();

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
    longPressWindowMs: LONG_PRESS_WINDOW_MS,
    pulseLockoutMs: PULSE_LOCKOUT_MS,
    textDedupMs: TEXT_DEDUP_MS,
    nodeMap: parseNodeMap()
  };
}

module.exports = {
  setSocketIO,
  handleMeshtasticPacket, // テスト用
  getNodeInfo,
  setNodeMap,
  resetNodeMap,
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

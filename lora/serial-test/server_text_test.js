// serialport と socket を差し替えて server/lora.js の文字列処理だけ検証する (実機・npm install 不要)
// 使い方: node lora/serial-test/server_text_test.js
const Module = require('module');
const path = require('path');
const root = path.join(__dirname, '..', '..', 'server');
const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'serialport') return { SerialPort: {} };
  if (req === './socket') return { processTeamReadyChange: (t) => { global.__ready.push(t); } };
  return origLoad.apply(this, arguments);
};
global.__ready = [];
process.env.LORA_NODE_MAP = JSON.stringify({ C414: 'A', D0E4: 'A', CCCC: 'B' });
const os = require('os');
const fs = require('fs');
process.env.LORA_NODE_MAP_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lora-map-')), 'map.json');
const quiet = console.log; console.log = () => {}; console.warn = () => {};
const state = require(path.join(root, 'state.js'));
const lora = require(path.join(root, 'lora.js'));
const emitted = [];
lora.setSocketIO({ emit: (ev, d) => emitted.push([ev, d]) });
console.log = quiet;

let pass = 0, fail = 0;
const ok = (name, cond) => { (cond ? pass++ : fail++); console.log((cond ? 'PASS ' : 'FAIL ') + name); };
const N = { C414: 0xf115c414, D0E4: 0xf115d0e4, CCCC: 0xf115cccc, UNKNOWN: 0xf1159999 };
const send = (node, text, portnum = 'TEXT_MESSAGE_APP') => {
  console.log = () => {}; console.warn = () => {};
  lora.handleMeshtasticPacket({ from: node, text, portnum, rssi: -26, snr: 6 });
  console.log = quiet;
};
const quietState = (fn) => { console.log = () => {}; const r = fn(); console.log = quiet; return r; };
const setup = (phase, rule = 'フラッグ戦') => quietState(() => {
  lora.closeSerial(); // 重複排除の記録をリセット (同期部分で実行される)
  state.updateState({ phase });
  state.updateSettings({ rule, teams: { red: { position: 'A', ready: false }, yellow: { position: 'B', ready: false } } });
  emitted.length = 0;
});
const lastSignal = () => (emitted.filter((e) => e[0] === 'loraSignal').pop() || [])[1];

// 1: 開始前に C414(=A) が SHORT -> 赤の準備完了
setup('pre-game');
send(N.C414, 'SHORT#5');
ok('SHORT from C414 (A) -> red ready', state.getState().settings.teams.red.ready === true && lastSignal().action === 'ready-on');
// 2: 同じポジションの別ノード(D0E4=A)からの重複は1回にまとめる (準備完了が戻らない)
send(N.D0E4, 'SHORT');
ok('duplicate from 2nd node for same position ignored', state.getState().settings.teams.red.ready === true);
// 3: ノード対応表が本文のポジションより優先される (CCCC=B なのに本文が :A でも B)
setup('pre-game');
send(N.CCCC, 'SHORT:A#1');
ok('node map beats text position (CCCC -> B/yellow)', state.getState().settings.teams.yellow.ready === true && state.getState().settings.teams.red.ready === false);
// 4: 未登録ノードは本文のポジションを使う
setup('pre-game');
send(N.UNKNOWN, 'SHORT:A');
ok('unmapped node uses text position', state.getState().settings.teams.red.ready === true);
// 5: 未登録ノード + 本文にポジションなし -> 無視
setup('pre-game');
send(N.UNKNOWN, 'SHORT');
ok('unmapped + no position -> ignored', !emitted.some((e) => e[0] === 'loraSignal'));
// 6: 通常のチャットは無視 (旧方式のパルスに流れない)
setup('pre-game');
send(N.C414, 'hello everyone');
ok('chat text ignored', !emitted.some((e) => e[0] === 'loraSignal') && !emitted.some((e) => e[0] === 'loraPending'));
// 7: 想定外の形式は無視
send(N.C414, 'SHORT:ZZ');
send(N.C414, 'LONGISH');
ok('malformed ignored', !emitted.some((e) => e[0] === 'loraSignal'));
// 8: ゲーム中(フラッグ戦) LONG -> フラッグ獲得(ゲーム終了) / SHORT は無視
setup('in-game');
send(N.C414, 'SHORT');
ok('SHORT ignored in flag rule', lastSignal().action === 'ignored' && state.getState().phase === 'in-game');
send(N.C414, 'LONG:A#9');
ok('LONG in flag rule -> flag-capture', lastSignal().action === 'flag-capture');
// 9: CANCEL は記録のみ
setup('in-game');
send(N.C414, 'CANCEL:A:4.2#7');
ok('CANCEL has no effect', !emitted.some((e) => e[0] === 'loraSignal'));
// 10: 無限復活戦 SHORT -> 復活カウント
setup('in-game', '無限復活戦');
const before = state.getState().gameData.redButtonCount;
send(N.D0E4, 'SHORT');
ok('respawn count in infinite-respawn', state.getState().gameData.redButtonCount === before + 1);
// 11: 旧方式 (Detection Sensor) は従来どおりパルス扱い -> loraPending
setup('pre-game');
send(N.C414, 'BUTTON_ON detected', 'DETECTION_SENSOR_APP');
ok('legacy detection sensor still goes through pulse window', emitted.some((e) => e[0] === 'loraPending'));

// ===== 対応表の編集 (管理画面API相当) =====
const q = (fn) => { console.log = () => {}; try { return fn(); } finally { console.log = quiet; } };
ok('initial map comes from .env', lora.getNodeInfo().source === 'env' && lora.getNodeInfo().nodeMap.C414 === 'A');
// 12: 保存 -> 反映 (C414 を A から B に付け替え)。正規化 (小文字・!) も確認
q(() => lora.setNodeMap({ c414: 'b', '!f115d0e4': 'A' }));
ok('saved map takes over from .env', lora.getNodeInfo().source === 'saved' && lora.getNodeInfo().nodeMap.C414 === 'B');
setup('pre-game');
send(N.C414, 'SHORT');
ok('reassigned C414 -> B (yellow)', state.getState().settings.teams.yellow.ready === true && state.getState().settings.teams.red.ready === false);
// 8桁キー ('!f115d0e4' -> F115D0E4) でも一致する
setup('pre-game');
send(N.D0E4, 'SHORT');
ok('8-digit node id key matches', state.getState().settings.teams.red.ready === true);
// 不正な入力は拒否し、既存の対応表は変えない
let rejected = 0;
for (const bad of [{ ZZZZ: 'A' }, { C414: 'Z' }, { C414: 'AA' }, null, [], { '123': 'A' }]) {
  try { q(() => lora.setNodeMap(bad)); } catch (e) { rejected++; }
}
ok('invalid maps rejected', rejected === 6 && lora.getNodeInfo().nodeMap.C414 === 'B');
// 再読み込み (再起動相当): ファイルが保存されている
ok('map persisted to file', JSON.parse(fs.readFileSync(process.env.LORA_NODE_MAP_FILE, 'utf8')).C414 === 'B');
// 受信したノードの一覧 (未登録ノードも載る)
ok('seen nodes list includes unmapped node', lora.getNodeInfo().seenNodes.some((n) => n.shortId === '9999'));
// リセット -> .env に戻る
q(() => lora.resetNodeMap());
ok('reset returns to .env', lora.getNodeInfo().source === 'env' && lora.getNodeInfo().nodeMap.C414 === 'A' && !fs.existsSync(process.env.LORA_NODE_MAP_FILE));

console.log(`\n${pass} passed, ${fail} failed`);
lora.closeSerial().then(() => process.exit(fail ? 1 : 0));

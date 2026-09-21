// サバゲー進行システム - 管理画面JavaScript
// Socket.IO通信、UI制御、音声再生を管理

// Socket.IO接続
const socket = io();

// 現在の状態
let currentState = null;
let gameOptions = null;
let savedGameIds = new Set(); // 保存済みゲームIDを記録
let lastPlaybackId = null; // 現在再生中のID
let isGameStarting = false; // ゲーム開始処理中フラグ

// DOM要素
const elements = {
    connectionStatus: document.getElementById('connectionStatus'),
    phaseIndicator: document.getElementById('phaseIndicator'),

    timerDisplay: document.getElementById('timerDisplay'),
    timerValue: document.getElementById('timerValue'),
    timerLabel: document.getElementById('timerLabel'),

    phaseWaiting: document.getElementById('phase-waiting'),
    phaseInterval: document.getElementById('phase-interval'),
    phasePreGame: document.getElementById('phase-pre-game'),
    phaseInGame: document.getElementById('phase-in-game'),
    phaseGameOver: document.getElementById('phase-game-over'),

    intervalTime: document.getElementById('intervalTime'),
    gameRule: document.getElementById('gameRule'),
    gameTime: document.getElementById('gameTime'),
    redPosition: document.getElementById('redPosition'),
    yellowPosition: document.getElementById('yellowPosition'),

    optionToggle: document.getElementById('optionToggle'),
    optionsSection: document.getElementById('optionsSection'),
    option1: document.getElementById('option1'),
    option2: document.getElementById('option2'),

    redReady: document.getElementById('redReady'),
    yellowReady: document.getElementById('yellowReady'),
    autoProgress: document.getElementById('autoProgress'),

    startIntervalBtn: document.getElementById('startIntervalBtn'),
    resetBtn: document.getElementById('resetBtn'),
    swapPositions: document.getElementById('swapPositions'),
    skipIntervalBtn: document.getElementById('skipIntervalBtn'),
    startGameBtn: document.getElementById('startGameBtn'),
    endGameBtn: document.getElementById('endGameBtn'),
    newGameBtn: document.getElementById('newGameBtn'),

    audioPlayer: document.getElementById('audioPlayer'),
    audioIndicator: document.getElementById('audioIndicator'),
    audioText: document.getElementById('audioText'),

    debugConnection: document.getElementById('debugConnection'),
    debugPhase: document.getElementById('debugPhase'),
    debugLora: document.getElementById('debugLora'),
    radioStatusGrid: document.getElementById('radioStatusGrid')
};

// 電波状況パネルで表示するポジション（現在稼働中のデバイス構成）
const RADIO_POSITIONS = ['A', 'B', 'C', 'D', 'E'];
const radioStatusByPosition = {};

function initRadioStatusGrid() {
    if (!elements.radioStatusGrid) return;
    elements.radioStatusGrid.innerHTML = RADIO_POSITIONS.map(pos => `
        <div class="radio-status-row" id="radioRow-${pos}">
            <span class="pos-label">${pos}</span>
            <span class="radio-status-text">未受信</span>
        </div>
    `).join('');
}

function formatRadioQuality(rssi, snr) {
    const rssiText = (rssi === undefined || rssi === null) ? '—' : `${rssi}dBm`;
    const snrText = (snr === undefined || snr === null) ? '—' : `${Number(snr).toFixed(1)}dB`;
    return `RSSI ${rssiText} / SNR ${snrText}`;
}

function updateRadioStatus(position, { rssi, snr, label }) {
    if (!position || !RADIO_POSITIONS.includes(position)) return;

    radioStatusByPosition[position] = { rssi, snr, at: Date.now() };

    const row = document.getElementById(`radioRow-${position}`);
    if (!row) return;

    const textEl = row.querySelector('.radio-status-text');
    const time = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    textEl.textContent = `${formatRadioQuality(rssi, snr)}${label ? ` (${label})` : ''} @ ${time}`;

    row.classList.add('is-fresh');
    clearTimeout(row._fadeTimer);
    row._fadeTimer = setTimeout(() => row.classList.remove('is-fresh'), 4000);
}

// ---------- 送信機(ノードID) -> ポジション の対応表 ----------
let loraNodeInfo = null;

function fetchLoraNodes() {
    fetch('/api/lora/nodes')
        .then(response => response.json())
        .then(renderLoraNodes)
        .catch(error => console.error('送信機一覧取得エラー:', error));
}

// 対応表を保存する。サーバーが検証し、不正なら400でメッセージを返す
function saveLoraNodeMap(nodeMap) {
    return fetch('/api/lora/nodemap', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeMap })
    })
        .then(async response => {
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || '保存に失敗しました');
            renderLoraNodes(data);
            return true;
        })
        .catch(error => {
            showToast(`⚠️ ${error.message}`);
            fetchLoraNodes(); // 画面をサーバーの実際の状態に戻す
            return false;
        });
}

function makePositionSelect(positions, current, includeUnassigned) {
    const select = document.createElement('select');
    if (includeUnassigned) {
        const none = document.createElement('option');
        none.value = '';
        none.textContent = '未割当';
        select.appendChild(none);
    }
    positions.forEach(pos => {
        const option = document.createElement('option');
        option.value = pos;
        option.textContent = pos;
        select.appendChild(option);
    });
    select.value = current || '';
    return select;
}

function renderLoraNodes(info) {
    loraNodeInfo = info;
    const rowsEl = document.getElementById('nodeMapRows');
    const summaryEl = document.getElementById('nodeMapSummary');
    const sourceEl = document.getElementById('nodeMapSource');
    if (!rowsEl || !info) return;

    sourceEl.textContent = info.source === 'saved'
        ? '設定元: 管理画面で保存した設定'
        : '設定元: .env の初期値 (まだ管理画面で保存していません)';

    // 登録済み + 受信済みのノードを1つの一覧にまとめる
    const seenById = new Map(info.seenNodes.map(n => [n.shortId, n]));
    const ids = [...new Set([...Object.keys(info.nodeMap), ...info.seenNodes.map(n => n.shortId)])];
    // 8桁で登録されたノードは受信済みの短縮IDと同じ行にまとめる
    const shortOf = (id) => id.slice(-4);
    const rows = new Map();
    ids.forEach(id => {
        const key = shortOf(id);
        if (!rows.has(key)) rows.set(key, { shortId: key, mapKeys: [] });
        if (id in info.nodeMap) rows.get(key).mapKeys.push(id);
    });

    rowsEl.replaceChildren();
    if (rows.size === 0) {
        const empty = document.createElement('div');
        empty.className = 'node-map-empty';
        empty.textContent = '送信機がまだありません。信号を受信するとここに表示されます。';
        rowsEl.appendChild(empty);
    }

    rows.forEach(({ shortId, mapKeys }) => {
        const seen = seenById.get(shortId);
        const position = mapKeys.length ? info.nodeMap[mapKeys[0]] : '';

        const row = document.createElement('div');
        row.className = 'node-map-row' + (position ? '' : ' is-unassigned');

        const idEl = document.createElement('span');
        idEl.className = 'node-id';
        idEl.textContent = shortId;

        const seenEl = document.createElement('span');
        seenEl.className = 'node-seen';
        if (seen) {
            const time = new Date(seen.lastSeen).toLocaleTimeString('ja-JP', { hour12: false });
            seenEl.textContent = `最終受信 ${time} (${formatRadioQuality(seen.rssi, seen.snr)})`;
        } else {
            seenEl.textContent = '未受信';
        }

        const select = makePositionSelect(info.positions, position, true);
        select.setAttribute('aria-label', `ノード ${shortId} のポジション`);
        select.addEventListener('change', () => {
            const next = { ...info.nodeMap };
            mapKeys.forEach(k => delete next[k]);
            if (select.value) next[shortId] = select.value;
            saveLoraNodeMap(next);
        });

        row.append(idEl, seenEl, select);
        rowsEl.appendChild(row);
    });

    // ポジションごとの台数 (2台以上=冗長化、0台=信号が来ない)
    const counts = {};
    Object.values(info.nodeMap).forEach(pos => { counts[pos] = (counts[pos] || 0) + 1; });
    summaryEl.textContent = info.positions
        .map(pos => `${pos}:${counts[pos] || 0}台`)
        .join('  ');
}

function setupNodeMapControls() {
    const addSelect = document.getElementById('nodeMapAddPosition');
    const addInput = document.getElementById('nodeMapAddId');
    if (!addSelect || !addInput) return;

    ['A', 'B', 'C', 'D', 'E'].forEach(pos => {
        const option = document.createElement('option');
        option.value = pos;
        option.textContent = pos;
        addSelect.appendChild(option);
    });

    document.getElementById('nodeMapAddBtn').addEventListener('click', () => {
        const id = addInput.value.trim().replace(/^!/, '').toUpperCase();
        if (!id) return;
        saveLoraNodeMap({ ...(loraNodeInfo ? loraNodeInfo.nodeMap : {}), [id]: addSelect.value })
            .then(saved => { if (saved) addInput.value = ''; });
    });

    document.getElementById('nodeMapResetBtn').addEventListener('click', () => {
        if (!confirm('管理画面で保存した設定を破棄して、.env の初期値に戻しますか？')) return;
        fetch('/api/lora/nodemap', { method: 'DELETE' })
            .then(response => response.json())
            .then(renderLoraNodes)
            .catch(error => showToast(`⚠️ ${error.message}`));
    });

    fetchLoraNodes();
}

socket.on('loraNodes', renderLoraNodes);

// 音声ファイルのプリロード（存在しないファイルは静かにスキップされる）
function preloadAudioFiles() {
    const categories = {
        'game-over': ['flag_captured', 'game_end', 'post_game_announcement'],
        'in-game': ['10min', '10sec_before_end', '1min', '20min', '2min', '30min', '3min', '5min', 'remaining'],
        'interval': ['entry_closed', 'entry_closing_soon', 'game_start_10min_before', 'game_start_15min_before', 'game_start_3min_before', 'game_start_5min_before', 'game_start_60sec_before', 'game_starting_soon', 'gather_at_start_position'],
        'other': ['horn'],
        // all_ready / pre_game_safety_check / red_ready / red_cancel / yellow_ready / yellow_cancel は音源未収録
        'pre-game': ['all_ready', 'pre_game_safety_check', 'red_cancel', 'red_ready', 'start_countdown', 'yellow_cancel', 'yellow_ready'],
        'rule': [
            'a', 'add_rule', 'b', 'c', 'current_game', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
            'mode_annihilation', 'mode_attack_defend', 'mode_battle_royale', 'mode_counter_battle',
            'mode_counter_respawn', 'mode_flag_battle', 'mode_fox_hunt', 'mode_handgun',
            'mode_king_of_the_hill', 'mode_medic', 'mode_rescue', 'mode_spy', 'mode_team_deathmatch',
            'mode_terminator', 'mode_vip', 'mode_zombie',
            'n', 'next_game', 'o', 'p', 'q', 'r',
            'red_start_position',
            'rule_fullauto_off', 'rule_no_electric_gun', 'rule_no_english', 'rule_no_japanese',
            'rule_real_count', 'rule_respawn_count_1', 'rule_respawn_count_2', 'rule_respawn_count_3',
            'rule_respawn_cutoff_10min', 'rule_respawn_cutoff_1min', 'rule_respawn_cutoff_3min',
            'rule_respawn_cutoff_5min', 'rule_respawn_cutoff_zero_counter', 'rule_respawn_enabled',
            'rule_respawn_exit_instruction', 'rule_respawn_infinite', 'rule_respawn_method_counter',
            'rule_respawn_method_drum', 'rule_respawn_method_teammate', 'rule_semi_auto_only',
            's', 'start_position_generic',
            't', 'terrorist_start_position',
            'time_10min', 'time_15min', 'time_1min', 'time_20min', 'time_25min', 'time_2min',
            'time_30min', 'time_3min', 'time_40min', 'time_4min', 'time_50min', 'time_5min',
            'time_10sec', 'time_60min', 'time_6min', 'time_7min', 'time_8min', 'time_9min', 'time_limit',
            'u', 'v', 'w', 'x', 'y', 'yellow_start_position', 'z'
        ]
    };

    const audioFiles = [];
    Object.entries(categories).forEach(([dir, files]) => {
        files.forEach(name => audioFiles.push(`${dir}/${name}.wav`));
    });

    audioFiles.forEach((file) => {
        const audio = new Audio(`/assets/sounds/${file}`);
        audio.preload = 'auto';
        audio.load();
    });

    console.log(`🔊 音声ファイルのプリロードを開始（${audioFiles.length}件、未配置のファイルは無視されます）`);
}

// 初期化
document.addEventListener('DOMContentLoaded', () => {
    console.log('管理画面初期化開始');

    initRadioStatusGrid();
    preloadAudioFiles();

    socket.emit('joinAdmin');

    fetch('/api/options')
        .then(response => response.json())
        .then(options => {
            gameOptions = options;
            initializePositionOptions();
        })
        .catch(error => console.error('オプション取得エラー:', error));

    setupEventListeners();
    setupNodeMapControls();
    updateConnectionStatus('connecting');
});

// Socket.IOイベントリスナー
socket.on('connect', () => {
    updateConnectionStatus('connected');
});

socket.on('disconnect', () => {
    updateConnectionStatus('disconnected');
});

socket.on('gameStateUpdate', (state) => {
    currentState = state;
    updateUI();
});

socket.on('timerUpdate', (timer) => {
    updateTimer(timer);
});

socket.on('playSound', (data) => {
    lastPlaybackId = data.playbackId || null;
    playSound(data.filename);
});

socket.on('loraSignal', (data) => {
    showLoRaSignal(data);
    updateRadioStatus(data.position, { rssi: data.rssi, snr: data.snr, label: PRESS_TYPE_NAMES[data.signalType] });
});

socket.on('loraPending', (data) => {
    showToast(`📡 ${data.position || '?'} 信号受信 — 判定中…`, true);
    updateRadioStatus(data.position, { rssi: data.rssi, snr: data.snr, label: '判定中' });
});

socket.on('error', (data) => {
    console.error('サーバーエラー:', data.message);
    alert('エラー: ' + data.message);

    if (data.message && (data.message.includes('準備') || data.message.includes('ゲーム開始'))) {
        isGameStarting = false;
        updateButtonStates();
    }
});

// イベントリスナー設定
function setupEventListeners() {
    elements.intervalTime.addEventListener('change', updateSettings);
    elements.gameRule.addEventListener('change', updateSettings);
    elements.gameTime.addEventListener('change', updateSettings);
    elements.redPosition.addEventListener('change', handlePositionChange);
    elements.yellowPosition.addEventListener('change', handlePositionChange);
    elements.option1.addEventListener('change', () => { syncChipState(elements.option1); updateSettings(); });
    elements.option2.addEventListener('change', () => { syncChipState(elements.option2); updateSettings(); });

    elements.optionToggle.addEventListener('click', toggleOptions);

    elements.swapPositions.addEventListener('click', () => {
        socket.emit('swapTeamPositions');
    });

    elements.redReady.addEventListener('change', () => {
        socket.emit('toggleTeamReady', { team: 'red' });
    });
    elements.yellowReady.addEventListener('change', () => {
        socket.emit('toggleTeamReady', { team: 'yellow' });
    });

    elements.autoProgress.addEventListener('change', () => {
        socket.emit('updateAutoProgress', { enabled: elements.autoProgress.checked });
    });

    elements.startIntervalBtn.addEventListener('click', () => {
        socket.emit('startInterval');
    });

    elements.skipIntervalBtn.addEventListener('click', () => {
        socket.emit('skipInterval');
    });

    elements.startGameBtn.addEventListener('click', () => {
        isGameStarting = true;
        elements.startGameBtn.disabled = true;
        socket.emit('startGame');
    });

    elements.endGameBtn.addEventListener('click', () => {
        if (confirm('ゲームを終了しますか？')) {
            socket.emit('endGame');
        }
    });

    elements.newGameBtn.addEventListener('click', () => {
        socket.emit('resetState');
    });

    elements.resetBtn.addEventListener('click', () => {
        if (confirm('設定をリセットしますか？')) {
            resetSettings();
        }
    });

    elements.audioPlayer.addEventListener('ended', () => {
        socket.emit('soundFinished', { playbackId: lastPlaybackId });
        updateAudioStatus('待機中', '🔇');
    });

    elements.audioPlayer.addEventListener('error', () => {
        socket.emit('soundFinished', { playbackId: lastPlaybackId });
        updateAudioStatus('エラー', '❌');
    });

    // デバッグ: テスト信号送信
    // "2,A"=短押し / "3,A"=長押し / "raw,A"=生パルス1回(判定ウィンドウを通す)
    document.querySelectorAll('[data-test-signal]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const [signalType, position] = btn.dataset.testSignal.split(',');
            if (signalType === 'raw') {
                sendTestPulse(position);
            } else {
                sendTestSignal(parseInt(signalType, 10), position);
            }
        });
    });
}

// チップ（オプション）の見た目を checked 状態に同期（:has() 非対応環境向けフォールバック）
function syncChipState(input) {
    const chip = input.closest('.chip');
    if (chip) chip.classList.toggle('is-checked', input.checked);
}

// 位置選択肢の初期化
function initializePositionOptions() {
    if (!gameOptions) return;

    const positions = gameOptions.positions || [];

    elements.redPosition.innerHTML = '<option value="">選択してください</option>';
    elements.yellowPosition.innerHTML = '<option value="">選択してください</option>';

    positions.forEach(pos => {
        elements.redPosition.add(new Option(pos, pos));
        elements.yellowPosition.add(new Option(pos, pos));
    });
}

// 位置変更処理（重複防止）
function handlePositionChange() {
    const redPos = elements.redPosition.value;
    const yellowPos = elements.yellowPosition.value;

    if (redPos && yellowPos && redPos === yellowPos) {
        alert('同じ位置は選択できません');
        if (currentState && currentState.settings) {
            elements.redPosition.value = currentState.settings.teams.red.position || '';
            elements.yellowPosition.value = currentState.settings.teams.yellow.position || '';
        }
        return;
    }

    updateSettings();
}

// 設定更新
function updateSettings() {
    const settings = {
        intervalTime: parseInt(elements.intervalTime.value) || null,
        rule: elements.gameRule.value || null,
        gameTime: parseInt(elements.gameTime.value) || null,
        options: getSelectedOptions(),
        autoProgress: elements.autoProgress ? elements.autoProgress.checked : false,
        teams: {
            red: { position: elements.redPosition.value || null, ready: false },
            yellow: { position: elements.yellowPosition.value || null, ready: false }
        }
    };

    socket.emit('updateSettings', settings);
}

function getSelectedOptions() {
    const options = [];
    if (elements.option1.checked) options.push(elements.option1.value);
    if (elements.option2.checked) options.push(elements.option2.value);
    return options;
}

// オプション表示切り替え
function toggleOptions() {
    const isHidden = elements.optionsSection.hidden;
    elements.optionsSection.hidden = !isHidden;
    elements.optionToggle.textContent = isHidden ? '- オプションを閉じる' : '+ オプションを追加';
}

// 設定リセット
function resetSettings() {
    elements.intervalTime.value = '';
    elements.gameRule.value = '';
    elements.gameTime.value = '';
    elements.redPosition.value = '';
    elements.yellowPosition.value = '';
    elements.option1.checked = false;
    elements.option2.checked = false;
    syncChipState(elements.option1);
    syncChipState(elements.option2);
    elements.optionsSection.hidden = true;
    elements.optionToggle.textContent = '+ オプションを追加';

    updateSettings();
}

// UI更新
function updateUI() {
    if (!currentState) return;

    updatePhaseIndicator();
    updatePhaseSteps();
    updatePhaseContent();
    updateSettingsDisplay();
    updateButtonStates();
    updateDebugInfo();

    // タイマーはisRunning中しかtimerUpdateイベントが飛んでこないため、
    // ここでも現在値を反映しておかないと前回ゲームの残り時間が画面に残ったままになる
    updateTimer(currentState.timer);
}

const PHASE_NAMES = {
    'waiting': '待機中',
    'interval': '休憩中',
    'pre-game': 'ゲーム開始前',
    'in-game': 'ゲーム中',
    'game-over': 'ゲーム終了'
};

function updatePhaseIndicator() {
    elements.phaseIndicator.textContent = PHASE_NAMES[currentState.phase] || currentState.phase;
}

function updatePhaseSteps() {
    const steps = ['waiting', 'interval', 'pre-game', 'in-game', 'game-over'];
    const currentIndex = steps.indexOf(currentState.phase);

    steps.forEach((step, index) => {
        const stepElement = document.getElementById(`step-${step}`);
        if (stepElement) {
            stepElement.classList.remove('active', 'completed');
            if (index < currentIndex) {
                stepElement.classList.add('completed');
            } else if (index === currentIndex) {
                stepElement.classList.add('active');
            }
        }
    });
}

function updatePhaseContent() {
    ['phaseWaiting', 'phaseInterval', 'phasePreGame', 'phaseInGame', 'phaseGameOver'].forEach((key) => {
        if (elements[key]) elements[key].hidden = true;
    });

    const currentPhaseElement = document.getElementById(`phase-${currentState.phase}`);
    if (currentPhaseElement) {
        currentPhaseElement.hidden = false;
    }

    switch (currentState.phase) {
        case 'waiting': updateWaitingPhase(); break;
        case 'pre-game': updatePreGamePhase(); break;
        case 'in-game': updateInGamePhase(); break;
        case 'game-over': updateGameOverPhase(); break;
    }
}

function updateWaitingPhase() {
    if (currentState.settings) {
        elements.intervalTime.value = currentState.settings.intervalTime || '';
        elements.gameRule.value = currentState.settings.rule || '';
        elements.gameTime.value = currentState.settings.gameTime || '';
        elements.redPosition.value = currentState.settings.teams?.red?.position || '';
        elements.yellowPosition.value = currentState.settings.teams?.yellow?.position || '';

        elements.option1.checked = currentState.settings.options?.includes('1回復活') || false;
        elements.option2.checked = currentState.settings.options?.includes('フルオート禁止') || false;
        syncChipState(elements.option1);
        syncChipState(elements.option2);

        if (elements.autoProgress) {
            elements.autoProgress.checked = currentState.settings.autoProgress || false;
        }
    }
}

function updatePreGamePhase() {
    if (currentState.settings && currentState.settings.teams) {
        elements.redReady.checked = currentState.settings.teams.red?.ready || false;
        elements.yellowReady.checked = currentState.settings.teams.yellow?.ready || false;
        updateReadyState('red', elements.redReady.checked);
        updateReadyState('yellow', elements.yellowReady.checked);
    }
    if (currentState.settings) {
        elements.autoProgress.checked = currentState.settings.autoProgress || false;
    }
}

function updateReadyState(team, isReady) {
    const toggle = document.querySelector(`.ready-toggle.${team}`);
    if (!toggle) return;
    const stateText = toggle.querySelector('.ready-state');
    if (stateText) stateText.textContent = isReady ? '準備完了！' : '準備中...';
}

function updateInGamePhase() {
    const gameStats = document.getElementById('gameStats');
    if (gameStats && currentState.settings?.rule === '無限復活戦') {
        gameStats.innerHTML = `
            <div class="row"><span>赤チーム 復活回数</span><span>${currentState.gameData?.redButtonCount || 0}回</span></div>
            <div class="row"><span>黄チーム 復活回数</span><span>${currentState.gameData?.yellowButtonCount || 0}回</span></div>
        `;
        gameStats.hidden = false;
    } else if (gameStats) {
        gameStats.hidden = true;
    }
}

const WINNER_NAMES = { 'red': '赤チーム', 'yellow': '黄チーム', 'draw': '引き分け' };
const REASON_NAMES = { 'flag': 'フラッグ獲得', 'timeout': '時間切れ', 'manual': '手動終了' };

function formatWinnerText(winner) {
    if (winner === 'draw') return '引き分け';
    return `${WINNER_NAMES[winner] || '不明'}の勝利`;
}

function updateGameOverPhase() {
    const resultDisplay = document.getElementById('resultDisplay');
    if (resultDisplay && currentState.result) {
        const gameKey = `${currentState.result.startTime}_${currentState.result.endTime}`;

        if (!savedGameIds.has(gameKey)) {
            saveGameResult(gameKey);
        }

        resultDisplay.innerHTML = `
            <h3>🏆 ゲーム結果</h3>
            <div class="winner-line">${formatWinnerText(currentState.result.winner)}</div>
            <div class="row"><span>終了理由</span><span>${REASON_NAMES[currentState.result.reason] || '不明'}</span></div>
            ${currentState.settings?.rule === '無限復活戦' ? `
                <div class="row"><span>赤チーム復活回数</span><span>${currentState.result.redScore || 0}回</span></div>
                <div class="row"><span>黄チーム復活回数</span><span>${currentState.result.yellowScore || 0}回</span></div>
            ` : ''}
            <div id="saveStatus" style="margin-top: 10px; font-size: 0.85em; color: var(--text-muted);">結果を保存中...</div>
        `;
    }
}

function updateSettingsDisplay() {
    const displays = ['settingsDisplay', 'settingsDisplayPreGame', 'settingsDisplayGame'];

    displays.forEach(displayId => {
        const display = document.getElementById(displayId);
        if (display && currentState.settings) {
            const settings = currentState.settings;
            display.innerHTML = `
                <div class="row"><span>休憩時間</span><span>${formatTime(settings.intervalTime)}</span></div>
                <div class="row"><span>ルール</span><span>${settings.rule || '未設定'}</span></div>
                <div class="row"><span>制限時間</span><span>${formatTime(settings.gameTime)}</span></div>
                ${settings.options && settings.options.length > 0 ?
                    `<div class="row"><span>オプション</span><span>${settings.options.join(', ')}</span></div>` : ''
                }
                <div class="row"><span>赤チーム位置</span><span>${settings.teams?.red?.position || '未設定'}</span></div>
                <div class="row"><span>黄チーム位置</span><span>${settings.teams?.yellow?.position || '未設定'}</span></div>
            `;
        }
    });
}

function updateButtonStates() {
    const canStartInterval = currentState.phase === 'waiting' && validateSettings();
    elements.startIntervalBtn.disabled = !canStartInterval;

    if (elements.startGameBtn) {
        if (isGameStarting || currentState.phase !== 'pre-game') {
            elements.startGameBtn.disabled = true;
        } else {
            const canStartGame = currentState.settings?.teams?.red?.ready &&
                currentState.settings?.teams?.yellow?.ready;
            elements.startGameBtn.disabled = !canStartGame;
        }
    }

    if (currentState.phase === 'in-game' || currentState.phase === 'waiting') {
        isGameStarting = false;
    }
}

function validateSettings() {
    if (!currentState.settings) return false;

    const { intervalTime, rule, gameTime, teams } = currentState.settings;
    return !!(intervalTime && rule && gameTime &&
              teams?.red?.position && teams?.yellow?.position);
}

function updateTimer(timer) {
    if (!timer) return;

    elements.timerValue.textContent = formatTime(timer.current);

    const labels = {
        'waiting': 'タイマー停止中',
        'interval': '休憩終了まで',
        'pre-game': '待機時間',
        'in-game': '残り時間',
        'game-over': 'ゲーム終了'
    };
    elements.timerLabel.textContent = labels[currentState?.phase] || 'タイマー';

    elements.timerValue.className = 'timer-value';
    // タイマーが実際に動いていないとき（待機中・ゲーム終了後の00:00など）は
    // 警告色や点滅を付けない。カウントダウン中のみ残り時間の緊急度を表示する
    if (timer.isRunning && timer.direction === 'down' && timer.current <= 60) {
        elements.timerValue.classList.add('warning');
    }
    if (timer.isRunning && timer.direction === 'down' && timer.current <= 10) {
        elements.timerValue.classList.add('danger');
    }
}

function formatTime(seconds) {
    if (!seconds && seconds !== 0) return '未設定';

    const mins = Math.floor(Math.abs(seconds) / 60);
    const secs = Math.abs(seconds) % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function updateConnectionStatus(status) {
    elements.connectionStatus.className = `pill is-${status}`;
    const statusTexts = {
        'connecting': '接続中...',
        'connected': '接続済み',
        'disconnected': '切断'
    };
    elements.connectionStatus.textContent = statusTexts[status] || status;
}

// 音声再生
function playSound(filename) {
    const soundPath = `/assets/sounds/${filename}`;

    elements.audioPlayer.pause();
    elements.audioPlayer.currentTime = 0;
    elements.audioPlayer.src = soundPath;
    elements.audioPlayer.volume = 1.0;

    elements.audioPlayer.addEventListener('canplaythrough', function playWhenReady() {
        const playPromise = elements.audioPlayer.play();

        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    updateAudioStatus(`再生中: ${filename}`, '🔊');
                })
                .catch(() => {
                    socket.emit('soundFinished', { playbackId: lastPlaybackId });
                    updateAudioStatus('再生エラー', '❌');
                });
        }

        elements.audioPlayer.removeEventListener('canplaythrough', playWhenReady);
    });

    elements.audioPlayer.addEventListener('error', function handleError() {
        socket.emit('soundFinished', { playbackId: lastPlaybackId });
        updateAudioStatus('読み込みエラー', '❌');
        elements.audioPlayer.removeEventListener('error', handleError);
    }, { once: true });

    elements.audioPlayer.load();
}

function updateAudioStatus(text, indicator) {
    elements.audioText.textContent = text;
    elements.audioIndicator.textContent = indicator;

    elements.audioIndicator.classList.remove('playing');
    if (indicator === '🔊') {
        elements.audioIndicator.classList.add('playing');
    }
}

// LoRa(Meshtastic)信号のトースト表示
const LORA_ACTION_NAMES = {
    'ready-on': '準備完了 ON',
    'ready-off': '準備完了 OFF',
    'respawn': '復活 +1',
    'flag-capture': 'フラッグ獲得!',
    'ignored': '信号 (このフェーズでは無効)'
};

const PRESS_TYPE_NAMES = { 1: '準備', 2: '短押し', 3: '長押し' };

function showLoRaSignal(data) {
    const teams = { 'red': '赤', 'yellow': '黄' };
    const actionText = LORA_ACTION_NAMES[data.action] || '信号';
    const pressText = PRESS_TYPE_NAMES[data.signalType] || '';
    const quality = (data.rssi !== undefined || data.snr !== undefined)
        ? ` [${formatRadioQuality(data.rssi, data.snr)}]`
        : '';

    showToast(`📡 ${teams[data.team] || '?'}チーム ${pressText}: ${actionText}${quality}`, data.action === 'ignored');
}

function showToast(message, muted = false) {
    const notification = document.createElement('div');
    notification.className = 'toast' + (muted ? ' toast-muted' : '');
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => notification.remove(), 3000);
}

function updateDebugInfo() {
    elements.debugConnection.textContent = socket.connected ? '接続中' : '切断';
    elements.debugPhase.textContent = currentState?.phase || '不明';

    fetch('/api/lora')
        .then(response => response.json())
        .then(stats => {
            elements.debugLora.textContent = stats.isConnected ? '接続中' : '切断（開発モード）';
        })
        .catch(() => {
            elements.debugLora.textContent = 'エラー';
        });
}

// テスト信号送信（デバッグ用、実機なしでMeshtastic受信相当の動作を確認）
function sendTestSignal(signalType, position) {
    fetch('/api/test/lora', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signalType, position })
    })
        .then(response => response.json())
        .catch(error => console.error('テスト信号エラー:', error));
}

// 生パルス注入（実機のDetection Sensor通知1回分。1回=短押し、ウィンドウ内2回=長押し）
function sendTestPulse(position) {
    fetch('/api/test/lora-pulse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position })
    })
        .then(response => response.json())
        .catch(error => console.error('テストパルスエラー:', error));
}

// ゲーム結果保存
function saveGameResult(gameKey) {
    if (!currentState.result) return;

    const resultData = {
        timestamp: new Date().toISOString(),
        gameId: `game_${Date.now()}`,
        settings: currentState.settings,
        result: currentState.result,
        gameData: currentState.gameData,
        phase: currentState.phase,
        timer: currentState.timer
    };

    fetch('/api/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resultData)
    })
        .then(response => response.json())
        .then(result => {
            savedGameIds.add(gameKey);
            const saveStatus = document.getElementById('saveStatus');
            if (saveStatus) {
                saveStatus.innerHTML = `✅ 結果を保存しました (${result.filename})`;
                saveStatus.style.color = 'var(--green)';
            }
        })
        .catch(() => {
            const saveStatus = document.getElementById('saveStatus');
            if (saveStatus) {
                saveStatus.innerHTML = '❌ 結果の保存に失敗しました';
                saveStatus.style.color = 'var(--red)';
            }
        });
}

// トースト用スタイル追加
const style = document.createElement('style');
style.textContent = `
    .toast {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--surface-2, #1c2226);
        color: var(--text, #eaeeee);
        border: 1px solid var(--accent, #ff8a00);
        border-left: 4px solid var(--accent, #ff8a00);
        padding: 10px 18px;
        border-radius: 2px;
        font-weight: 700;
        font-size: 0.85rem;
        letter-spacing: 0.06em;
        z-index: 1000;
        animation: fade-in 0.2s ease;
        box-shadow: 0 8px 20px rgba(0,0,0,0.45);
    }
    .toast.toast-muted {
        border-color: var(--border, #38424a);
        border-left-color: var(--border, #38424a);
        color: var(--text-muted, #97a3aa);
    }
`;
document.head.appendChild(style);

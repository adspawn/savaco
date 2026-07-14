// サバゲー進行システム - 表示画面JavaScript
// 受信専用の表示画面制御

const socket = io();

let currentState = null;

const elements = {
    stage: document.getElementById('stage'),
    connectionStatus: document.getElementById('connectionStatus'),

    currentPhase: document.getElementById('currentPhase'),
    phaseDescription: document.getElementById('phaseDescription'),

    timerValue: document.getElementById('timerValue'),
    timerLabel: document.getElementById('timerLabel'),

    gameInfo: document.getElementById('gameInfo'),
    gameRule: document.getElementById('gameRule'),
    gameTime: document.getElementById('gameTime'),
    redPosition: document.getElementById('redPosition'),
    yellowPosition: document.getElementById('yellowPosition'),

    teamStatus: document.getElementById('teamStatus'),
    redTeamPosition: document.getElementById('redTeamPosition'),
    yellowTeamPosition: document.getElementById('yellowTeamPosition'),
    redReadyStatus: document.getElementById('redReadyStatus'),
    yellowReadyStatus: document.getElementById('yellowReadyStatus'),
    redReadyIndicator: document.getElementById('redReadyIndicator'),
    yellowReadyIndicator: document.getElementById('yellowReadyIndicator'),

    gameStats: document.getElementById('gameStats'),
    redButtonCount: document.getElementById('redButtonCount'),
    yellowButtonCount: document.getElementById('yellowButtonCount'),

    gameResult: document.getElementById('gameResult'),
    winnerText: document.getElementById('winnerText'),
    resultDetails: document.getElementById('resultDetails'),

    audioIcon: document.getElementById('audioIcon'),
    audioStatus: document.getElementById('audioStatus'),

    errorOverlay: document.getElementById('errorOverlay'),
    confettiLayer: document.getElementById('confettiLayer')
};

const PHASE_INFO = {
    'waiting': { name: '待機中', description: 'ゲームの設定を行っています' },
    'interval': { name: '休憩中', description: 'ゲーム開始までお待ちください' },
    'pre-game': { name: 'ゲーム開始前', description: 'プレイヤーの準備完了をお待ちください' },
    'in-game': { name: 'ゲーム中', description: 'ゲームが進行中です' },
    'game-over': { name: 'ゲーム終了', description: 'ゲームが終了しました' }
};

document.addEventListener('DOMContentLoaded', () => {
    socket.emit('joinDisplay');
    updateConnectionStatus('connecting');
});

socket.on('connect', () => {
    updateConnectionStatus('connected');
    hideError();
});

socket.on('disconnect', () => {
    updateConnectionStatus('disconnected');
    showError();
});

socket.on('connect_error', () => {
    updateConnectionStatus('disconnected');
    showError();
});

socket.on('gameStateUpdate', (state) => {
    currentState = state;
    updateDisplay();
});

socket.on('timerUpdate', (timer) => {
    updateTimer(timer);
});

socket.on('playSound', () => {
    updateAudioStatus('再生中', '🔊', true);
});

socket.on('loraSignal', (data) => {
    showLoRaNotification(data);
});

function updateDisplay() {
    if (!currentState) return;

    updatePhaseDisplay();
    updateProgressSteps();
    updateGameInfo();
    updateTeamStatus();
    updateGameStats();
    updateGameResult();
}

function updatePhaseDisplay() {
    const phase = currentState.phase;
    const info = PHASE_INFO[phase] || { name: phase, description: '' };

    elements.currentPhase.textContent = info.name;
    elements.phaseDescription.textContent = info.description;
    elements.currentPhase.className = 'phase-name ' + phase;
    elements.stage.dataset.phase = phase;
}

function updateProgressSteps() {
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

function updateGameInfo() {
    const shouldShow = ['interval', 'pre-game', 'in-game', 'game-over'].includes(currentState.phase);

    if (shouldShow && currentState.settings) {
        elements.gameInfo.hidden = false;

        elements.gameRule.textContent = currentState.settings.rule || '-';
        elements.gameTime.textContent = formatTime(currentState.settings.gameTime) || '-';
        elements.redPosition.textContent = currentState.settings.teams?.red?.position || '-';
        elements.yellowPosition.textContent = currentState.settings.teams?.yellow?.position || '-';
    } else {
        elements.gameInfo.hidden = true;
    }
}

function updateTeamStatus() {
    const shouldShow = currentState.phase === 'pre-game';

    if (shouldShow && currentState.settings?.teams) {
        elements.teamStatus.hidden = false;

        const redTeam = currentState.settings.teams.red;
        const yellowTeam = currentState.settings.teams.yellow;

        elements.redTeamPosition.textContent = `位置: ${redTeam.position || '-'}`;
        elements.yellowTeamPosition.textContent = `位置: ${yellowTeam.position || '-'}`;

        updateTeamReadyStatus('red', redTeam.ready);
        updateTeamReadyStatus('yellow', yellowTeam.ready);
    } else {
        elements.teamStatus.hidden = true;
    }
}

function updateTeamReadyStatus(team, isReady) {
    const statusElement = elements[team + 'ReadyStatus'];
    const indicatorElement = elements[team + 'ReadyIndicator'];

    if (statusElement && indicatorElement) {
        statusElement.classList.remove('ready');

        if (isReady) {
            statusElement.classList.add('ready');
            indicatorElement.textContent = '✅';
            statusElement.querySelector('.ready-text').textContent = '準備完了！';
        } else {
            indicatorElement.textContent = '⏳';
            statusElement.querySelector('.ready-text').textContent = '準備中...';
        }
    }
}

function updateGameStats() {
    const shouldShow = currentState.phase === 'in-game' &&
                      currentState.settings?.rule === '無限復活戦';

    if (shouldShow && currentState.gameData) {
        elements.gameStats.hidden = false;

        elements.redButtonCount.textContent = currentState.gameData.redButtonCount || 0;
        elements.yellowButtonCount.textContent = currentState.gameData.yellowButtonCount || 0;

        animateCounterChange(elements.redButtonCount);
        animateCounterChange(elements.yellowButtonCount);
    } else {
        elements.gameStats.hidden = true;
    }
}

const WINNER_NAMES = { 'red': '赤チーム', 'yellow': '黄チーム', 'draw': '引き分け' };
const REASON_NAMES = { 'flag': 'フラッグ獲得', 'timeout': '時間切れ', 'manual': '手動終了' };

function updateGameResult() {
    const shouldShow = currentState.phase === 'game-over';

    if (shouldShow && currentState.result) {
        elements.gameResult.hidden = false;

        const result = currentState.result;
        elements.winnerText.textContent = result.winner === 'draw'
            ? '引き分け'
            : `${WINNER_NAMES[result.winner] || '不明'}の勝利！`;
        elements.winnerText.className = `winner-text ${result.winner}`;

        let detailsHTML = `<div>終了理由: ${REASON_NAMES[result.reason] || '不明'}</div>`;

        if (currentState.settings?.rule === '無限復活戦') {
            detailsHTML += `
                <div>赤チーム復活回数: ${result.redScore || 0}回</div>
                <div>黄チーム復活回数: ${result.yellowScore || 0}回</div>
            `;
        }

        elements.resultDetails.innerHTML = detailsHTML;

        if (!elements.gameResult.dataset.celebrated) {
            elements.gameResult.dataset.celebrated = '1';
            showWinnerEffect(result.winner);
        }
    } else {
        elements.gameResult.hidden = true;
        delete elements.gameResult.dataset.celebrated;
    }
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
    if (timer.direction === 'down' && timer.current <= 60) {
        elements.timerValue.classList.add('warning');
    }
    if (timer.direction === 'down' && timer.current <= 10) {
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

function updateAudioStatus(status, icon, isPlaying = false) {
    elements.audioStatus.textContent = status;
    elements.audioIcon.textContent = icon;

    elements.audioIcon.classList.remove('playing');
    if (isPlaying) {
        elements.audioIcon.classList.add('playing');
    }

    if (isPlaying) {
        setTimeout(() => {
            updateAudioStatus('待機中', '🔇', false);
        }, 5000);
    }
}

function showError() {
    elements.errorOverlay.hidden = false;
}

function hideError() {
    elements.errorOverlay.hidden = true;
}

function showLoRaNotification(data) {
    const signalTypes = { 1: '準備完了', 2: 'ボタン押下' };
    const teams = { 'red': '赤', 'yellow': '黄' };

    const message = `📡 ${teams[data.team] || '?'}チーム ${signalTypes[data.signalType] || '信号'}`;

    const notification = document.createElement('div');
    notification.className = 'stage-toast';
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => notification.remove(), 3000);
}

function animateCounterChange(element) {
    element.style.transform = 'scale(1.2)';
    element.style.color = 'var(--accent)';

    setTimeout(() => {
        element.style.transform = 'scale(1)';
        element.style.color = '';
    }, 300);
}

function showWinnerEffect(winner) {
    if (winner === 'draw') return;

    for (let i = 0; i < 60; i++) {
        setTimeout(() => createConfetti(winner), i * 40);
    }
}

function createConfetti(winner) {
    const confetti = document.createElement('div');
    const color = winner === 'red' ? '#f87171' : '#fbbf24';

    confetti.className = 'confetti-piece';
    confetti.style.left = `${Math.random() * 100}%`;
    confetti.style.background = color;
    confetti.style.animationDuration = `${2.5 + Math.random() * 1.5}s`;

    elements.confettiLayer.appendChild(confetti);

    setTimeout(() => confetti.remove(), 4200);
}

// 定期的なハートビート（接続確認）
setInterval(() => {
    if (socket.connected) {
        socket.emit('ping');
    }
}, 30000);

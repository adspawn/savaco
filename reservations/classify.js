// 予定のタイトル/説明を Claude で判定する
// API キーではなく、Pro プランでログイン済みの Claude Code CLI (`claude -p`) を呼び出す

const { spawn } = require('child_process');
const os = require('os');

// プロンプトを変えたら上げる (キャッシュ済みの判定を作り直すため)
const PROMPT_VERSION = 1;

const KINDS = ['reservation', 'charter', 'cancelled', 'closed', 'full', 'staff', 'notice', 'other'];

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer' },
          kind: { type: 'string', enum: KINDS },
          people_min: { type: ['integer', 'null'] },
          people_max: { type: ['integer', 'null'] },
          name: { type: ['string', 'null'] },
          note: { type: 'string' },
        },
        required: ['i', 'kind', 'people_min', 'people_max', 'name', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `あなたはサバイバルゲームフィールドの予約カレンダーを読み取る係です。
各行はカレンダーの予定1件 (番号<TAB>タイトル<TAB>説明) です。全行について、番号 i を付けて判定結果を返してください。

kind:
- reservation: 個人・グループの予約 (例「2名 川崎様」「5名様」「PSU 39名様」「みついき様 2名」)
- charter: 貸切 (「貸切」を含む)
- cancelled: キャンセル済みの予約
- closed: 休業 (定休日、雨天中止、臨時休業、お休み、改装工事など)
- full: 満員・受付終了の告知 (満員御礼、受付終了)
- staff: ボランティア・スタッフなど客ではない参加
- notice: お知らせ・イベント告知・チケット購入などの案内
- other: 上のどれにも当てはまらないもの

人数 (people_min / people_max):
- 「N名」「N名様」「N人」が来場人数。全角数字も同じ。
- 幅がある場合は「3〜4名」→ 3 と 4、「10〜20名」→ 10 と 20、「26名前後」→ 26 と 26。
- 「10名様〜」「10名以上」のように上限がないときは people_max を null。
- 幅がないときは people_max = people_min。
- 1件に複数グループが書かれているときは合計 (例「12名様午前中貸切　4名様」→ 16 と 16、kind は charter)。
- 「初心者パックN」「初N」「ガンN」「電動ガンN」「ゴールN」「レンタルN」の数字はレンタル数で、人数ではありません。
- 「12時」「10:30」などの時刻も人数ではありません。
- 「30名様まで」「10名様受付終了」のような定員・上限の数字は人数ではありません (people_min/max は null、note に書く)。
- 予約だが人数が書かれていなければ people_min / people_max は null。推測で埋めないこと。
- reservation / charter 以外は people_min / people_max を null。

name: 予約者・団体名 (「様」は除く)。なければ null。
note: 初心者パック・レンタル・時刻・定員など補足を短い日本語で。なければ空文字。`;

class UsageLimitError extends Error {}

function quoteForCmd(arg) {
  // Windows の claude.cmd を shell 経由で起動する場合の引数クォート
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

function runClaude(prompt, { model, bin }) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(SCHEMA),
    '--system-prompt', SYSTEM_PROMPT,
    '--tools', '',
    '--strict-mcp-config',
    '--no-session-persistence',
  ];
  if (model) args.push('--model', model);

  const spawnOnce = (useShell) =>
    new Promise((resolve, reject) => {
      const child = spawn(bin, useShell ? args.map(quoteForCmd) : args, {
        // プロジェクトの CLAUDE.md などを読み込ませないよう一時フォルダで実行
        cwd: os.tmpdir(),
        shell: useShell,
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(prompt);
    });

  return spawnOnce(false).catch((err) => {
    // npm でインストールした claude.cmd は shell 経由でないと起動できない
    if (process.platform === 'win32' && (err.code === 'ENOENT' || err.code === 'EINVAL')) {
      return spawnOnce(true);
    }
    throw err;
  });
}

// texts: 判定したい文字列の配列。戻り値は同じ順番の判定結果
async function classifyBatch(texts, { fieldName, model, bin = 'claude' }) {
  const lines = texts.map((t, i) => `${i}\t${t.replace(/[\t\n]+/g, ' ')}`);
  const prompt = `フィールド: ${fieldName}\n\n${lines.join('\n')}`;

  const { code, stdout, stderr } = await runClaude(prompt, { model, bin });

  let result;
  try {
    result = JSON.parse(stdout);
  } catch {
    throw new Error(`claude の出力を読めませんでした (exit ${code}): ${(stderr || stdout).slice(0, 500)}`);
  }

  if (result.is_error || !result.structured_output) {
    const message = String(result.result || stderr || '').slice(0, 500);
    if (result.api_error_status === 429 || /limit|上限/i.test(message)) {
      throw new UsageLimitError(`Claude の利用上限に達しました: ${message}`);
    }
    throw new Error(`claude の判定に失敗しました: ${message}`);
  }

  const byIndex = new Map(result.structured_output.items.map((item) => [item.i, item]));
  return texts.map((_, i) => {
    const item = byIndex.get(i);
    if (!item) return null;
    const { i: _i, ...rest } = item;
    return rest;
  });
}

module.exports = { classifyBatch, UsageLimitError, PROMPT_VERSION, KINDS };

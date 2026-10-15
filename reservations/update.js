// 各フィールドの予約カレンダー (公開 iCal) を取得し、Claude で予約人数を判定して保存する
//
//   npm run reservations              … 通常 (直近 RESERVATION_LOOKBACK_DAYS 日以降の未判定分だけ AI に送る)
//   npm run reservations -- --all     … 過去分もすべて判定 (初回の一括処理用)
//   npm run reservations -- --dry-run … 取得と件数確認だけ (AI は呼ばない)
//
// その他: --field <id> / --since YYYY-MM-DD / --max-calls N / --batch-size N / --ics <ファイル>

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');

const { parseIcs, addDays, TIME_ZONE } = require('./ics');
const { classifyBatch, UsageLimitError, PROMPT_VERSION } = require('./classify');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const CACHE_FILE = path.join(DATA_DIR, 'cache.json');
const FIELDS_FILE = path.join(ROOT, 'fields.json');

const COUNTED_KINDS = new Set(['reservation', 'charter']);
const SPAN_KINDS = new Set(['closed', 'full']); // 複数日にまたがる終日予定を日ごとに展開する種類

function parseArgs(argv) {
  const opts = { all: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') opts.all = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--field') opts.field = argv[++i];
    else if (a === '--since') opts.since = argv[++i];
    else if (a === '--max-calls') opts.maxCalls = Number(argv[++i]);
    else if (a === '--batch-size') opts.batchSize = Number(argv[++i]);
    else if (a === '--ics') opts.ics = argv[++i];
    else throw new Error(`不明なオプション: ${a}`);
  }
  return opts;
}

function today() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE }).format(new Date());
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function loadCache() {
  try {
    const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (cache.version === PROMPT_VERSION) return cache;
    console.log('判定ルールが更新されたため、キャッシュを作り直します');
  } catch {
    // 初回
  }
  return { version: PROMPT_VERSION, entries: {} };
}

// 判定に使う文字列。同じ文字列 (例「2名様」) は1回だけ AI に送る
function textOf(event) {
  return [event.summary, event.description].filter(Boolean).join(' / ');
}

async function loadIcs(field, opts) {
  if (opts.ics) return fs.readFileSync(opts.ics, 'utf8');
  let res;
  try {
    res = await fetch(field.icsUrl);
  } catch (err) {
    throw new Error(`${field.name}: iCal に接続できませんでした (${err.cause?.code || err.message})`);
  }
  if (!res.ok) throw new Error(`${field.name}: iCal の取得に失敗しました (HTTP ${res.status})`);
  return res.text();
}

function buildDays(events, cache) {
  const days = new Map();
  const dayOf = (date) => {
    if (!days.has(date)) {
      days.set(date, {
        date,
        closed: false,
        full: false,
        charter: false,
        people_min: 0,
        people_max: 0,
        open_ended: false, // 「10名様〜」など上限なしの予約がある
        unknown_people: 0, // 人数が書かれていない予約の件数
        unclassified: 0, // まだ AI 判定していない予定の件数
        entries: [],
      });
    }
    return days.get(date);
  };

  for (const event of events) {
    const cls = cache.entries[textOf(event)] || null;
    let dates = [event.date];
    if (cls && SPAN_KINDS.has(cls.kind)) {
      for (let d = addDays(event.date, 1); d <= event.endDate && dates.length < 31; d = addDays(d, 1)) {
        dates.push(d);
      }
    }

    for (const date of dates) {
      const day = dayOf(date);
      day.entries.push({ summary: event.summary, ...(cls || { kind: 'unclassified' }) });
      if (!cls) {
        day.unclassified++;
        continue;
      }
      if (cls.kind === 'closed') day.closed = true;
      if (cls.kind === 'full') day.full = true;
      if (cls.kind === 'charter') day.charter = true;
      if (!COUNTED_KINDS.has(cls.kind)) continue;
      if (cls.people_min == null) {
        day.unknown_people++;
        continue;
      }
      day.people_min += cls.people_min;
      day.people_max += cls.people_max ?? cls.people_min;
      if (cls.people_max == null) day.open_ended = true;
    }
  }

  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(rows) {
  const header = ['field', 'date', 'closed', 'full', 'charter', 'people_min', 'people_max',
    'open_ended', 'unknown_people', 'unclassified', 'titles'];
  const lines = rows.map((r) => [
    r.field, r.date, r.closed, r.full, r.charter, r.people_min, r.people_max,
    r.open_ended, r.unknown_people, r.unclassified, r.entries.map((e) => e.summary).join(' | '),
  ].map(csvCell).join(','));
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Excel で文字化けしないよう BOM 付き
  fs.writeFileSync(path.join(DATA_DIR, 'daily.csv'), `﻿${[header.join(','), ...lines].join('\n')}\n`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const lookback = Number(process.env.RESERVATION_LOOKBACK_DAYS || 30);
  const since = opts.all ? '0000-00-00' : opts.since || addDays(today(), -lookback);
  const maxCalls = opts.maxCalls || Number(process.env.RESERVATION_MAX_CALLS || 30);
  const batchSize = opts.batchSize || 100;
  const model = process.env.RESERVATION_CLAUDE_MODEL || 'sonnet';
  const bin = process.env.CLAUDE_BIN || 'claude';

  const fields = JSON.parse(fs.readFileSync(FIELDS_FILE, 'utf8'))
    .filter((f) => !opts.field || f.id === opts.field);
  if (fields.length === 0) throw new Error('対象のフィールドがありません (reservations/fields.json を確認)');

  const cache = loadCache();
  let calls = 0;
  let stoppedReason = null;
  const csvRows = [];

  for (const field of fields) {
    console.log(`\n■ ${field.name} (${field.id})`);
    let events;
    try {
      const ics = await loadIcs(field, opts);
      fs.mkdirSync(path.join(DATA_DIR, field.id), { recursive: true });
      fs.writeFileSync(path.join(DATA_DIR, field.id, 'calendar.ics'), ics);
      events = parseIcs(ics).filter((e) => e.status !== 'CANCELLED' && e.summary);
    } catch (err) {
      console.error(`  取得エラー: ${err.message}`);
      continue;
    }

    const recurring = events.filter((e) => e.recurring).length;
    if (recurring) console.log(`  ※ 繰り返し予定 ${recurring} 件は初回の日付だけ扱います`);

    const pending = [...new Set(
      events.filter((e) => e.date >= since).map(textOf).filter((t) => !cache.entries[t]),
    )];
    console.log(`  予定 ${events.length} 件 / ${since} 以降の未判定 ${pending.length} 種類`);

    if (!opts.dryRun) {
      for (let i = 0; i < pending.length && !stoppedReason; i += batchSize) {
        if (calls >= maxCalls) {
          stoppedReason = `1回の実行で呼べる上限 (${maxCalls} 回) に達しました`;
          break;
        }
        const batch = pending.slice(i, i + batchSize);
        process.stdout.write(`  AI 判定 ${i + batch.length}/${pending.length} ... `);
        try {
          calls++;
          const results = await classifyBatch(batch, { fieldName: field.name, model, bin });
          batch.forEach((text, j) => {
            if (results[j]) cache.entries[text] = results[j];
          });
          writeJson(CACHE_FILE, cache); // 途中で止まっても次回は続きから
          console.log('OK');
        } catch (err) {
          console.log('失敗');
          if (err instanceof UsageLimitError) {
            stoppedReason = err.message;
          } else {
            console.error(`  ${err.message}`);
          }
        }
      }
    }

    const days = buildDays(events, cache);
    writeJson(path.join(DATA_DIR, field.id, 'days.json'), {
      field: { id: field.id, name: field.name },
      updatedAt: new Date().toISOString(),
      days,
    });
    csvRows.push(...days.map((d) => ({ field: field.id, ...d })));
    const left = days.reduce((n, d) => n + d.unclassified, 0);
    console.log(`  保存: data/${field.id}/days.json (${days.length} 日分${left ? `、未判定 ${left} 件` : ''})`);
  }

  writeCsv(csvRows);
  console.log(`\nClaude 呼び出し ${calls} 回`);
  if (stoppedReason) {
    console.log(`途中で止めました: ${stoppedReason}\n残りは次回の実行で続きから判定します。`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

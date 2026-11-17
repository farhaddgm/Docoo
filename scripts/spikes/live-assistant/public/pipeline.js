/**
 * صفحهٔ آزمایش pipeline: ضبط میکروفون ← سرور محلی (رونویسی، مدل متنی، صدا) ← پخش. نتیجهٔ هر نوبت
 * به رویدادهای شبیه مسیر بلادرنگ تبدیل می‌شود تا همان tracker و امتیازدهی و گزارش کار کند.
 */
import { priceTotals, addTotals, EMPTY_TOTALS } from '/lib/cost.mjs';
import { eventsForTurn } from '/lib/pipeline.mjs';
import { renderMarkdown } from '/lib/report.mjs';
import { scoreScenario } from '/lib/score.mjs';
import { createTracker } from '/lib/tracker.mjs';

const $ = (id) => document.getElementById(id);

const state = {
  cfg: { scenarios: [], prices: null, hasKey: false },
  mic: null,
  recorder: null,
  chunks: [],
  recStartedAt: 0,
  active: null, // { scenario | null } نوبت در حال ضبط
  busy: false,
  freeTracker: createTracker(),
  results: [],
  events: [],
  activeMs: 0,
  sttSeconds: 0,
  ttsCharacters: 0,
  turns: 0,
};

function log(line) {
  const box = $('log');
  box.textContent = `${new Date().toLocaleTimeString()}  ${line}\n${box.textContent}`.slice(
    0,
    6000,
  );
}

function setStatus(text, bad = false) {
  $('status').textContent = text;
  $('status').className = bad ? 'bad' : '';
}

async function api(url, body, init = {}) {
  const request = init.body
    ? { method: 'POST', headers: { 'x-spike': '1', ...init.headers }, body: init.body }
    : body
      ? {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-spike': '1' },
          body: JSON.stringify(body),
        }
      : undefined;
  const response = await fetch(url, request);
  return { status: response.status, data: await response.json().catch(() => null) };
}

function setRow(id, text) {
  const cell = document.querySelector(`[data-result="${CSS.escape(id)}"]`);
  if (cell) cell.textContent = text;
}

function renderStats() {
  let totals = { ...EMPTY_TOTALS };
  for (const { score } of state.results) totals = addTotals(totals, score.totals);
  totals = addTotals(totals, state.freeTracker.snapshot().totals);
  const usd = priceTotals(totals, state.cfg.prices);
  $('stats').textContent =
    `توکن مدل متنی: ${totals.totalTokens} (ورودی ${totals.inputTokens}، خروجی ${totals.outputTokens})` +
    ` · رونویسی: ${Math.round(state.sttSeconds)} ثانیه · صدا: ${state.ttsCharacters} نویسه` +
    ` · هزینهٔ مدل متنی (کران بالا): ${usd === null ? 'بدون قیمت' : `$${usd.toFixed(3)}`}`;
}

async function ready() {
  try {
    state.mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    setStatus('میکروفون آماده است');
  } catch (error) {
    setStatus(`میکروفون در دسترس نیست: ${error instanceof Error ? error.message : error}`, true);
  }
}

function startRecording(scenario) {
  if (!state.mic) return setStatus('اول «آماده» را بزنید', true);
  if (state.active || state.busy) return log('نوبت قبلی هنوز تمام نشده است.');
  state.chunks = [];
  state.recorder = new MediaRecorder(state.mic);
  state.recorder.ondataavailable = (event) => {
    if (event.data.size > 0) state.chunks.push(event.data);
  };
  state.recorder.start();
  state.recStartedAt = performance.now();
  state.active = { scenario };
  if (scenario) setRow(scenario.id, 'در حال ضبط…');
  setStatus('در حال ضبط… (پایان را بزنید)');
}

function stopRecording() {
  return new Promise((resolve) => {
    state.recorder.onstop = () => resolve(performance.now());
    state.recorder.stop();
  });
}

async function playAndTime(base64) {
  if (!base64) return null;
  const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
  const started = new Promise((resolve) => {
    audio.addEventListener('playing', () => resolve(performance.now()), { once: true });
    audio.addEventListener('error', () => resolve(null), { once: true });
  });
  const ended = new Promise((resolve) => audio.addEventListener('ended', resolve, { once: true }));
  await audio.play().catch(() => null);
  const firstAudioAt = await started;
  if (firstAudioAt !== null) await ended;
  return firstAudioAt;
}

async function finishRecording() {
  const current = state.active;
  if (!current || state.busy) return;
  state.busy = true;
  const stoppedAt = await stopRecording();
  state.active = null;
  const blob = new Blob(state.chunks, { type: state.recorder.mimeType || 'audio/webm' });
  const scenario = current.scenario;
  const tracker = scenario ? createTracker() : state.freeTracker;
  if (scenario) setRow(scenario.id, 'در حال پردازش…');
  setStatus('در حال پردازش…');
  try {
    const query = new URLSearchParams({ voice: $('voice').value, language: $('language').value });
    const { status, data } = await api(`/api/turn?${query}`, null, {
      body: blob,
      headers: { 'content-type': blob.type },
    });
    if (status !== 200 || !data) {
      const detail = data?.error
        ? `${data.error.stage ?? ''} ${data.error.status ?? ''}: ${data.error.body ?? ''}`
        : `HTTP ${status}`;
      throw new Error(detail);
    }
    const firstAudioAt = data.audioBase64 ? await playAndTime(data.audioBase64) : null;
    const turn = {
      transcript: data.transcript,
      reply: data.reply ?? '',
      toolCalls: data.toolCalls ?? [],
      usage: data.usage ?? { input: 0, output: 0, cached: 0 },
      speechStoppedAt: stoppedAt,
      firstAudioAt,
    };
    const id = `r${++state.turns}`;
    for (const { at, event } of eventsForTurn(turn, id)) {
      tracker.ingest(event, at);
      state.events.push(JSON.stringify(event).slice(0, 4000));
    }
    state.sttSeconds += data.sttSeconds ?? 0;
    state.ttsCharacters += data.ttsCharacters ?? 0;
    state.activeMs +=
      stoppedAt - state.recStartedAt + (firstAudioAt ? firstAudioAt - stoppedAt : 0);
    for (const call of turn.toolCalls) log(`ابزار: ${call.name}(${call.arguments})`);
    log(
      `رونویسی ${data.timings.sttMs} ms · مدل ${data.timings.llmMs} ms · صدا ${data.timings.ttsMs} ms`,
    );
    if (scenario) {
      const score = scoreScenario(scenario, tracker.snapshot());
      state.results = state.results.filter((item) => item.scenario.id !== scenario.id);
      state.results.push({ scenario, score });
      const verdict = score.tool
        ? score.tool.ok
          ? 'ابزار درست'
          : `ابزار نادرست (${score.tool.calledName ?? 'صدا نزد'})`
        : score.noToolOk === null
          ? 'ثبت شد'
          : score.noToolOk
            ? 'درست (ابزار صدا نزد)'
            : 'نادرست (ابزار صدا زد)';
      setRow(scenario.id, `${verdict} — «${score.heard || 'رونویسی نیامد'}»`);
    }
    setStatus('آماده');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (scenario) setRow(scenario.id, `خطا: ${message}`);
    setStatus(message, true);
    log(`خطا: ${message}`);
  } finally {
    state.busy = false;
    renderStats();
  }
}

function renderScenarios() {
  const rows = $('rows');
  rows.textContent = '';
  for (const scenario of state.cfg.scenarios) {
    const row = rows.insertRow();
    row.insertCell().textContent = scenario.id;
    row.insertCell().textContent = scenario.spoken ?? '';
    const actions = row.insertCell();
    const start = document.createElement('button');
    start.type = 'button';
    start.textContent = 'ضبط';
    start.onclick = () => startRecording(scenario);
    const end = document.createElement('button');
    end.type = 'button';
    end.textContent = 'پایان';
    end.onclick = () => void finishRecording();
    actions.append(start, ' ', end);
    row.insertCell().dataset.result = scenario.id;
  }
}

async function save() {
  const free = state.freeTracker.snapshot();
  const results = [...state.results];
  if (free.responses.length > 0) {
    const scenario = { id: 'free-talk' };
    results.push({ scenario, score: scoreScenario(scenario, free) });
  }
  const notes = [
    `مسیر pipeline: رونویسی \`${state.cfg.sttModel}\` · مدل متنی \`${state.cfg.llmModel}\` · صدا (TTS) \`${state.cfg.ttsModel}\`.`,
    `مصرف ElevenLabs: ${Math.round(state.sttSeconds)} ثانیه رونویسی و ${state.ttsCharacters} نویسه صدا؛ این‌ها بر حسب توکن نیستند و در «هزینه» نیامده‌اند، پس هزینهٔ بالا فقط مدل متنی است و کمتر از هزینهٔ واقعی.`,
    'تأخیر از لحظهٔ «پایان» تا شروع پخش اولین صدای پاسخ است و شامل بارگیری کل پاسخ است (نه جریانی).',
    'این مسیر اتصال همیشه‌باز ندارد؛ آزمون مرورگر پنهان و هزینهٔ بی‌حرفی برایش معنا ندارد و «نامعلوم» می‌ماند.',
  ].join('\n\n');
  const markdown = renderMarkdown({
    meta: {
      model: `${state.cfg.llmModel} (pipeline)`,
      voice: $('voice').selectedOptions[0]?.textContent ?? null,
      transcriptionModel: state.cfg.sttModel,
      activeSeconds: state.activeMs / 1000,
      prices: state.cfg.prices,
    },
    results,
    notes,
  });
  const report = await api('/api/save', { name: 'report', content: markdown });
  await api('/api/save', { name: 'events', content: state.events.join('\n') });
  $('saved').textContent = report.data?.saved
    ? `ذخیره شد: ${report.data.saved} (در پوشهٔ --out)`
    : 'ذخیره نشد (سرور بدون --out اجرا شده؟)';
}

async function init() {
  state.cfg = (await api('/api/config')).data ?? state.cfg;
  $('keyState').textContent = state.cfg.hasKey
    ? 'کلیدها در سرور محلی موجودند.'
    : 'کلید ناقص است (حالت --dry-run): پردازش ممکن نیست.';
  $('models').textContent =
    `مدل متنی: ${state.cfg.llmModel ?? '—'} · رونویسی: ${state.cfg.sttModel ?? '—'} · صدا: ${state.cfg.ttsModel ?? '—'}`;
  const { status, data } = await api('/api/voices');
  const select = $('voice');
  select.textContent = '';
  if (status !== 200 || !data?.voices?.length) {
    const reason = data?.error ? `${data.error.status}: ${data.error.body}` : 'فهرست صدا خالی است';
    select.append(new Option('صدایی نیست', ''));
    log(`فهرست صداها: ${reason}`);
  } else {
    for (const voice of data.voices) {
      select.append(
        new Option(`${voice.name}${voice.languages.includes('fa') ? ' (fa)' : ''}`, voice.id),
      );
    }
  }
  renderScenarios();
  renderStats();
  $('ready').onclick = () => void ready();
  $('reset').onclick = async () => {
    await api('/api/reset', {});
    log('گفتگوی تازه شروع شد.');
  };
  $('freeStart').onclick = () => {
    startRecording(null);
    $('freeStart').disabled = true;
    $('freeEnd').disabled = false;
  };
  $('freeEnd').onclick = async () => {
    await finishRecording();
    $('freeStart').disabled = false;
    $('freeEnd').disabled = true;
  };
  $('save').onclick = () => void save();
}

void init();

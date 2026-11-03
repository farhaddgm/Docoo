/**
 * صفحهٔ آزمایش فاز ۰. منطق قابل‌آزمون (تحلیل رویداد، امتیاز، هزینه، گزارش) در /lib است؛ اینجا فقط
 * چسب مرورگر است: WebRTC، میکروفون یا پخش فایل ضبط‌شده، ضربان، و رابط.
 */
import { priceTotals, addTotals, EMPTY_TOTALS } from '/lib/cost.mjs';
import { summarizeHeartbeat } from '/lib/heartbeat.mjs';
import { renderMarkdown } from '/lib/report.mjs';
import { scoreScenario } from '/lib/score.mjs';
import { cannedToolResult } from '/lib/session.mjs';
import { createTracker } from '/lib/tracker.mjs';

const $ = (id) => document.getElementById(id);
const SETTLE_QUIET_MS = 2500;
const SETTLE_TIMEOUT_MS = 45_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const state = {
  cfg: { scenarios: [], prices: null, hasKey: false },
  pc: null,
  dc: null,
  ctx: null,
  dest: null,
  mic: null,
  callId: null,
  connectedAt: null,
  activeMs: 0,
  pending: 0,
  lastDoneAt: 0,
  handled: new Set(),
  freeTracker: createTracker(),
  current: null,
  results: [],
  events: [],
  samples: [],
  hbEvents: [],
  heartbeat: null,
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

async function api(url, body) {
  const init = body
    ? {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-spike': '1' },
        body: JSON.stringify(body),
      }
    : undefined;
  const response = await fetch(url, init);
  return { status: response.status, data: await response.json().catch(() => null) };
}

function sessionTotals() {
  let totals = { ...EMPTY_TOTALS };
  for (const { score } of state.results) totals = addTotals(totals, score.totals);
  return addTotals(totals, state.freeTracker.snapshot().totals);
}

function renderStats() {
  const totals = sessionTotals();
  const usd = priceTotals(totals, state.cfg.prices);
  $('stats').textContent =
    `توکن کل: ${totals.totalTokens} (ورودی ${totals.inputTokens}، خروجی ${totals.outputTokens})` +
    ` · هزینه (کران بالا): ${usd === null ? 'بدون قیمت (--prices را بدهید)' : `$${usd.toFixed(3)}`}`;
}

function ingest(event) {
  const now = performance.now();
  (state.current?.tracker ?? state.freeTracker).ingest(event, now);
  if (event.type === 'response.created') state.pending += 1;
  if (event.type === 'response.done') {
    state.pending = Math.max(0, state.pending - 1);
    state.lastDoneAt = now;
  }
  state.hbEvents.push({ t: Date.now(), kind: 'event' });
  const text = JSON.stringify(event);
  state.events.push(text.length > 4000 ? `${text.slice(0, 4000)}…` : text);
  if (event.type === 'error') log(`خطا: ${event.error?.message ?? text.slice(0, 200)}`);
  if (event.type === 'response.function_call_arguments.done' && !state.handled.has(event.call_id)) {
    state.handled.add(event.call_id);
    log(`ابزار: ${event.name}(${event.arguments})`);
    const output = JSON.stringify(cannedToolResult({ name: event.name }));
    state.dc?.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: event.call_id, output },
      }),
    );
    state.dc?.send(JSON.stringify({ type: 'response.create' }));
  }
  renderStats();
}

async function connect() {
  if (state.pc) return;
  const model = $('model').value.trim();
  if (!model) return setStatus('مدل را وارد کنید', true);
  setStatus('در حال اتصال…');
  try {
    state.ctx = new AudioContext();
    state.dest = state.ctx.createMediaStreamDestination();
    let track = state.dest.stream.getAudioTracks()[0];
    if ($('mode').value === 'mic') {
      state.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      track = state.mic.getAudioTracks()[0];
    }
    const pc = new RTCPeerConnection();
    const audio = new Audio();
    audio.autoplay = true;
    pc.ontrack = (event) => {
      audio.srcObject = event.streams[0];
    };
    pc.addTrack(track);
    const dc = pc.createDataChannel('oai-events');
    dc.onmessage = (message) => {
      try {
        ingest(JSON.parse(message.data));
      } catch {
        log('پیام غیرJSON از کانال داده');
      }
    };
    pc.onconnectionstatechange = () => {
      state.hbEvents.push({ t: Date.now(), kind: 'connection', state: pc.connectionState });
      setStatus(
        `اتصال: ${pc.connectionState}`,
        ['failed', 'disconnected'].includes(pc.connectionState),
      );
    };
    state.pc = pc;
    state.dc = dc;
    await pc.setLocalDescription(await pc.createOffer());
    const { status, data } = await api('/api/session', {
      sdp: pc.localDescription.sdp,
      model,
      voice: $('voice').value.trim(),
      transcriptionModel: $('stt').value.trim(),
      language: $('language').value,
    });
    if (status !== 200 || !data?.sdp) {
      const body = data?.error?.body ?? JSON.stringify(data);
      throw new Error(`سرویس‌دهنده ${data?.error?.status ?? status}: ${body}`);
    }
    state.callId = data.callId;
    await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
    state.connectedAt = Date.now();
    $('connect').disabled = true;
    $('disconnect').disabled = false;
    $('runAll').disabled = $('mode').value !== 'files';
    log(`وصل شد (callId=${state.callId ?? 'نامعلوم'})`);
    startHeartbeat();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'خطای ناشناخته', true);
    log(`اتصال ناموفق: ${error instanceof Error ? error.message : error}`);
    await teardown(false);
  }
}

async function teardown(hangup = true) {
  if (state.connectedAt) state.activeMs += Date.now() - state.connectedAt;
  state.connectedAt = null;
  stopHeartbeat();
  if (hangup && state.callId) await api('/api/hangup', { callId: state.callId }).catch(() => null);
  state.dc?.close();
  state.pc?.close();
  state.mic?.getTracks().forEach((track) => track.stop());
  await state.ctx?.close().catch(() => null);
  Object.assign(state, {
    pc: null,
    dc: null,
    ctx: null,
    dest: null,
    mic: null,
    callId: null,
    pending: 0,
  });
  $('connect').disabled = false;
  $('disconnect').disabled = true;
  $('runAll').disabled = true;
}

let heartbeatTimer = null;
function startHeartbeat() {
  heartbeatTimer = setInterval(() => {
    state.samples.push({ t: Date.now(), hidden: document.hidden });
    if (state.samples.length % 5 === 0) renderHidden();
  }, 1000);
}
function stopHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  renderHidden();
}
function renderHidden() {
  state.heartbeat = state.samples.some((sample) => sample.hidden)
    ? summarizeHeartbeat(state.samples, state.hbEvents)
    : null;
  const info = state.heartbeat;
  $('hidden').textContent = info
    ? `پنهان: ${info.hiddenSeconds} ثانیه · بزرگ‌ترین فاصلهٔ ضربان: ${info.maxHiddenGapMs} ms · رویداد در حالت پنهان: ${info.eventsWhileHidden} · اتصال قطع شد؟ ${info.connectionLostWhileHidden ? 'بله' : 'خیر'}`
    : 'هنوز دادهٔ پنهان‌بودن نیست.';
}

/** منتظر می‌ماند تا هیچ پاسخی در جریان نباشد و مدتی از آخرین پاسخ گذشته باشد. */
async function settle() {
  const started = performance.now();
  while (performance.now() - started < SETTLE_TIMEOUT_MS) {
    const quiet = performance.now() - state.lastDoneAt > SETTLE_QUIET_MS;
    if (state.pending === 0 && state.lastDoneAt > 0 && quiet) return true;
    await sleep(200);
  }
  return false;
}

function beginScenario(scenario) {
  state.current = { scenario, tracker: createTracker() };
  state.lastDoneAt = 0;
  setRow(scenario.id, 'در حال اجرا…');
}

async function endScenario() {
  const current = state.current;
  if (!current) return;
  const settled = await settle();
  state.current = null;
  const score = scoreScenario(current.scenario, current.tracker.snapshot());
  state.results = state.results.filter((item) => item.scenario.id !== current.scenario.id);
  state.results.push({ scenario: current.scenario, score });
  const verdict = score.tool
    ? score.tool.ok
      ? 'ابزار درست'
      : `ابزار نادرست (${score.tool.calledName ?? 'صدا نزد'})`
    : score.noToolOk === null
      ? 'ثبت شد'
      : score.noToolOk
        ? 'درست (ابزار صدا نزد)'
        : 'نادرست (ابزار صدا زد)';
  setRow(
    current.scenario.id,
    `${verdict}${settled ? '' : ' · مهلت تمام شد'} — «${score.heard || 'رونویسی نیامد'}»`,
  );
  renderStats();
}

function setRow(id, text) {
  const cell = document.querySelector(`[data-result="${CSS.escape(id)}"]`);
  if (cell) cell.textContent = text;
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
    start.textContent = 'شروع';
    start.onclick = () => beginScenario(scenario);
    const end = document.createElement('button');
    end.type = 'button';
    end.textContent = 'پایان';
    end.onclick = () => void endScenario();
    actions.append(start, ' ', end);
    row.insertCell().dataset.result = scenario.id;
  }
}

async function runAll() {
  const files = [...$('files').files];
  if (!state.pc || files.length === 0) return log('اول وصل شوید و فایل‌ها را انتخاب کنید.');
  for (const scenario of state.cfg.scenarios) {
    const file = files.find((item) => item.name.startsWith(scenario.id));
    if (!file) {
      setRow(scenario.id, 'فایل نداشت؛ رد شد');
      continue;
    }
    beginScenario(scenario);
    const buffer = await state.ctx.decodeAudioData(await file.arrayBuffer());
    const source = state.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(state.dest);
    await new Promise((resolve) => {
      source.onended = resolve;
      source.start();
    });
    await sleep(1500);
    await endScenario();
  }
}

async function save() {
  const free = state.freeTracker.snapshot();
  const results = [...state.results];
  if (free.responses.length > 0) {
    const scenario = { id: 'free-talk' };
    results.push({ scenario, score: scoreScenario(scenario, free) });
  }
  const connectedMs = state.connectedAt ? Date.now() - state.connectedAt : 0;
  const markdown = renderMarkdown({
    meta: {
      model: $('model').value.trim(),
      voice: $('voice').value.trim() || null,
      transcriptionModel: $('stt').value.trim() || null,
      activeSeconds: (state.activeMs + connectedMs) / 1000,
      prices: state.cfg.prices,
    },
    results,
    heartbeat: state.heartbeat,
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
    ? 'کلید در سرور محلی موجود است.'
    : 'کلید ندارد (حالت --dry-run): اتصال ممکن نیست.';
  const models = (await api('/api/models')).data?.models ?? [];
  $('models').replaceChildren(
    ...models.map((id) => Object.assign(document.createElement('option'), { value: id })),
  );
  renderScenarios();
  renderStats();
  $('connect').onclick = () => void connect();
  $('disconnect').onclick = () => void teardown(true);
  $('runAll').onclick = () => void runAll();
  $('save').onclick = () => void save();
}

void init();

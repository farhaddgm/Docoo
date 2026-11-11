'use client';

import type {
  MonitorKind,
  MonitorShareInfo,
  MonitorShareLook,
  ViewerMonitorView as ViewerView,
  VoiceMonitorView as VoiceView,
} from '@docoo/contracts';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import type { Locale } from '../i18n';
import { shareMessages } from './share-messages';
import { ViewerMonitorView } from './viewer-monitor-view';
import { VoiceMonitorView } from './voice-monitor-view';
import { watermarkText } from './window-model';

import './monitor.css';

type Phase = 'loading' | 'locked' | 'live' | 'ended' | 'missing' | 'off' | 'full';

interface Answer {
  readonly kind: MonitorKind;
  readonly look: MonitorShareLook;
  readonly view: ViewerView | VoiceView;
}

const code = async (response: Response): Promise<string | undefined> => {
  try {
    return ((await response.json()) as { code?: string }).code;
  } catch {
    return undefined;
  }
};

/**
 * The page a share link opens (no account). The visitor gives the password, then the screen reads
 * the monitor every few seconds like the owner's own window; each read also keeps its place among
 * the watchers the owner allowed. A password form reveals nothing but which monitor it is.
 */
export function ShareWindow({
  locale,
  token,
}: {
  readonly locale: Locale;
  readonly token: string;
}) {
  const text = shareMessages(locale).page;
  const base = `/api/public/monitor/${token}`;
  const [phase, setPhase] = useState<Phase>('loading');
  const [kind, setKind] = useState<MonitorKind | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [lost, setLost] = useState(false);
  const [problem, setProblem] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Which monitor the link is, and whether it still lives.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(base, { cache: 'no-store', signal: controller.signal });
        if (response.status === 404) return setPhase('missing');
        if (response.status === 410) return setPhase('ended');
        if (!response.ok) return setPhase('missing');
        setKind(((await response.json()) as MonitorShareInfo).kind);
        setPhase('locked');
      } catch {
        if (!controller.signal.aborted) setPhase('missing');
      }
    })();
    return () => controller.abort();
  }, [base]);

  // The watching loop, only while the screen is unlocked.
  const refreshS = useRef(3);
  const watching = phase === 'live' || phase === 'full' || phase === 'off';
  useEffect(() => {
    if (!watching) return;
    let stopped = false;
    let timer: number | undefined;
    const controller = new AbortController();
    const read = async () => {
      try {
        const response = await fetch(`${base}/view`, {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (stopped) return;
        if (response.ok) {
          const body = (await response.json()) as Answer;
          refreshS.current = Math.max(2, body.look.refreshS);
          setAnswer(body);
          setLost(false);
          setPhase('live');
        } else if (response.status === 401) {
          stopped = true;
          setAnswer(null);
          setPhase('locked');
          return;
        } else if (response.status === 410 || response.status === 404) {
          stopped = true;
          setAnswer(null);
          setPhase(response.status === 410 ? 'ended' : 'missing');
          return;
        } else if (response.status === 409) {
          const reason = await code(response);
          setAnswer(null);
          setPhase(reason === 'MONITOR_SHARE_FULL' ? 'full' : 'off');
        } else setLost(true);
      } catch {
        if (!stopped) setLost(true);
      }
      if (!stopped) timer = window.setTimeout(() => void read(), refreshS.current * 1000);
    };
    void read();
    return () => {
      stopped = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [watching, base]);

  const unlock = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setProblem('');
      try {
        const response = await fetch(`${base}/unlock`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        if (response.ok) {
          setPassword('');
          setPhase('live');
        } else if (response.status === 409) setPhase('full');
        else if (response.status === 410) setPhase('ended');
        else if (response.status === 404) setPhase('missing');
        else setProblem(response.status === 429 ? text.tooMany : text.wrong);
      } catch {
        setProblem(text.lost);
      } finally {
        setBusy(false);
      }
    },
    [base, password, text.lost, text.tooMany, text.wrong],
  );

  const look = answer?.look;
  const windowLocale: Locale =
    look?.language === 'fa' || look?.language === 'en' ? look.language : locale;
  const theme = look?.theme ?? 'dark';
  const clock = new Intl.DateTimeFormat(windowLocale === 'fa' ? 'fa-IR' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
  const mark = look ? watermarkText(look.watermark, look.workspaceName, clock) : '';
  const heading = kind ? shareMessages(locale).admin.kinds[kind] : text.title;

  const notice: Partial<Record<Phase, string>> = {
    loading: text.loading,
    ended: text.ended,
    missing: text.missing,
    off: text.off,
    full: text.full,
  };

  return (
    <div
      className={`monitor-window monitor-${theme}`}
      dir={windowLocale === 'fa' ? 'rtl' : 'ltr'}
      lang={windowLocale}
      style={{ fontSize: `${look?.fontScale ?? 1.5}rem` }}
      data-view={phase}
    >
      <header className="monitor-head">
        <h1>{heading}</h1>
        {phase === 'live' && look?.liveBadge && <span className="monitor-badge">{text.live}</span>}
      </header>
      <main
        className={phase === 'live' ? 'monitor-body monitor-body-wide' : 'monitor-body'}
        role="status"
        aria-live="polite"
      >
        {phase === 'locked' ? (
          <form className="monitor-share-form" onSubmit={(event) => void unlock(event)}>
            <label htmlFor="share-password">{text.password}</label>
            <input
              id="share-password"
              type="password"
              autoComplete="off"
              autoFocus
              required
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button type="submit" className="primary-button" disabled={busy || password === ''}>
              {text.open}
            </button>
            {problem && <p role="alert">{problem}</p>}
          </form>
        ) : phase === 'live' && answer ? (
          answer.kind === 'viewer' ? (
            <ViewerMonitorView view={answer.view as ViewerView} locale={windowLocale} lost={lost} />
          ) : (
            <VoiceMonitorView view={answer.view as VoiceView} locale={windowLocale} lost={lost} />
          )
        ) : (
          <p>{notice[phase] ?? text.loading}</p>
        )}
      </main>
      {phase === 'live' && mark && <footer className="monitor-mark">{mark}</footer>}
    </div>
  );
}

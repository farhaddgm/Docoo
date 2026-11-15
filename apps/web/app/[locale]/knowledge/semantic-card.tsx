'use client';

import { useCallback, useEffect, useState } from 'react';

import { apiGet, apiPost } from '../../api-client';
import { formatNumber, type Locale } from '../../i18n';
import { SectionTitle } from '../../info-tip';
import { fill } from '../agents/agent-messages';
import { Notice, useAction } from '../use-action';

interface Status {
  enabled: boolean;
  reason: string | null;
  model: string | null;
  eligible: number;
  embedded: number;
  keptLocal: number;
  heldBack: number;
}

const messages = {
  fa: {
    title: 'جست‌وجوی معنایی',
    help: 'با روشن‌بودن، متن اسناد «داخلی» با مدل embedding ارائه‌دهنده به بردار معنایی تبدیل می‌شود تا بازنویسی و فارسی/انگلیسی هم پیدا شود. اسناد «محرمانه» و «بسیار محرمانه» هرگز فرستاده نمی‌شوند. پرسش‌هایی که ایمیل، شماره یا کلید دارند هم فرستاده نمی‌شوند.',
    off: {
      not_enabled:
        'خاموش است. برای روشن‌کردن، مالک سامانه باید KNOWLEDGE_EMBEDDING_ENABLED را در تنظیمات محیطی سرور بگذارد.',
      internal_not_allowed:
        'خاموش است: ارسال متن اسناد داخلی هنوز مجاز نشده (KNOWLEDGE_EMBEDDING_ALLOW_INTERNAL).',
      not_configured: 'خاموش است: کلید یا مدل embedding در تنظیمات محیطی سرور نیست.',
    } as Record<string, string>,
    on: 'روشن است. مدل: {model}',
    progress: '{embedded} از {eligible} بخش از اسناد داخلی بردار معنایی دارد.',
    local: '{n} بخش از اسناد غیرداخلی فقط محلی می‌ماند و فرستاده نمی‌شود.',
    held: '{n} بخش از اسناد داخلی ایمیل، شماره تلفن، کد ملی، کارت یا شبا دارد و فقط محلی می‌ماند؛ با واژه همچنان پیدا می‌شود.',
    error: 'انجام نشد. دوباره تلاش کنید.',
    run: 'ساخت بردار برای اسناد تازه',
    running: 'در حال ساخت…',
    done: '{embedded} بخش بردار گرفت{failed}.',
    failed: '؛ {n} دسته ناموفق بود و دفعهٔ بعد دوباره تلاش می‌شود',
  },
  en: {
    title: 'Semantic search',
    help: 'When on, the text of “internal” documents is turned into semantic vectors by the provider’s embedding model, so paraphrases and Persian/English questions are found. “Confidential” and “restricted” documents are never sent. Questions that contain an e-mail, a number or a key are not sent either.',
    off: {
      not_enabled:
        'Off. To turn it on, the system owner must set KNOWLEDGE_EMBEDDING_ENABLED in the server environment.',
      internal_not_allowed:
        'Off: sending the text of internal documents is not allowed yet (KNOWLEDGE_EMBEDDING_ALLOW_INTERNAL).',
      not_configured: 'Off: the embedding key or model is not set in the server environment.',
    } as Record<string, string>,
    on: 'On. Model: {model}',
    progress: '{embedded} of {eligible} chunks of internal documents have a semantic vector.',
    local: '{n} chunk(s) of non-internal documents stay local and are never sent.',
    held: '{n} chunk(s) of internal documents hold an e-mail, phone, national id, card or IBAN number and stay local; they are still found by their words.',
    error: 'It did not work. Try again.',
    run: 'Embed new documents',
    running: 'Embedding…',
    done: '{embedded} chunk(s) embedded{failed}.',
    failed: '; {n} batch(es) failed and will be tried again next time',
  },
};

/** ADR-0061: whether semantic search is on, how much knowledge it covers, and a button to catch up. */
export function SemanticCard({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = messages[locale];
  const base = `/workspaces/${workspaceId}/knowledge/semantic-index`;
  const [status, setStatus] = useState<Status | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const { busy, notice, run: act } = useAction(() => text.error);

  const load = useCallback(async () => {
    setStatus(await apiGet<Status>(base));
  }, [base]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  function run() {
    void (async () => {
      let summary = '';
      const ok = await act(async () => {
        const response = (await (await apiPost(`${base}/run`, { limit: 500 })).json()) as {
          embedded?: number;
          failedBatches?: number;
        };
        summary = fill(text.done, {
          embedded: formatNumber(locale, response.embedded ?? 0),
          failed: response.failedBatches
            ? fill(text.failed, { n: formatNumber(locale, response.failedBatches) })
            : '',
        });
        await load();
      }, '');
      if (ok) setResult(summary);
    })();
  }

  if (status === null) return null;
  return (
    <section className="card stack" aria-labelledby="semantic-title">
      <SectionTitle id="semantic-title" help={text.help}>
        {text.title}
      </SectionTitle>
      {!status.enabled ? (
        <p className="muted">
          {text.off[status.reason ?? 'not_enabled'] ?? text.off['not_enabled']}
        </p>
      ) : (
        <>
          <p>{fill(text.on, { model: status.model ?? '—' })}</p>
          <p>
            {fill(text.progress, {
              embedded: formatNumber(locale, status.embedded),
              eligible: formatNumber(locale, status.eligible),
            })}
          </p>
          {status.keptLocal > 0 && (
            <p className="muted">
              {fill(text.local, { n: formatNumber(locale, status.keptLocal) })}
            </p>
          )}
          {status.heldBack > 0 && (
            <p className="muted">{fill(text.held, { n: formatNumber(locale, status.heldBack) })}</p>
          )}
          <div className="toolbar">
            <button
              className="secondary-button"
              type="button"
              disabled={busy || status.embedded + status.heldBack >= status.eligible}
              onClick={run}
            >
              {busy ? text.running : text.run}
            </button>
          </div>
          {result && (
            <p className="notice ok" role="status">
              {result}
            </p>
          )}
        </>
      )}
      <Notice notice={notice} />
    </section>
  );
}

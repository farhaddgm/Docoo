import type { VoiceMonitorCard, VoiceMonitorView } from '@docoo/contracts';

import type { Locale } from '../i18n';
import { monitorMessages } from './messages';
import {
  barPercent,
  fill,
  formatClock,
  formatCount,
  formatDollars,
  formatMinutes,
  providerName,
} from './voice-format';

/**
 * The voice assistant monitor for a room screen (ADR-0056 §6). It draws only what the view holds:
 * a part that the owner's settings hid arrives as `null` and is not drawn at all, so this file
 * never decides what is allowed to be shown.
 */
export function VoiceMonitorView({
  view,
  locale,
  lost = false,
}: {
  readonly view: VoiceMonitorView;
  readonly locale: Locale;
  readonly lost?: boolean;
}) {
  const text = monitorMessages(locale).voice;
  const current = view.sessions.find((session) => session.current) ?? null;
  const person = (name: string | null) => (name === null ? text.owner : name);

  return (
    <div className="voice-monitor">
      <header className="voice-head">
        <h2>{view.assistantName}</h2>
        {view.indicator !== null && (
          <span className={`voice-state voice-state-${view.indicator}`} role="status">
            <span className="voice-dot" aria-hidden="true" />
            {text.indicator[view.indicator]}
          </span>
        )}
      </header>
      {lost && <p className="voice-lost">{text.lost}</p>}

      <div className="voice-stats">
        {view.model !== null && (
          <section className="voice-stat" aria-label={text.modelTitle}>
            <h3>{text.modelTitle}</h3>
            <dl>
              {view.model.provider !== null && (
                <>
                  <dt>{text.fields.provider}</dt>
                  <dd>{providerName(view.model.provider)}</dd>
                </>
              )}
              {view.model.model !== null && (
                <>
                  <dt>{text.fields.model}</dt>
                  <dd dir="ltr">{view.model.model}</dd>
                </>
              )}
              {view.model.mode !== null && (
                <>
                  <dt>{text.fields.mode}</dt>
                  <dd>{modeLabel(view.model.mode, text.modes)}</dd>
                </>
              )}
              {view.model.language !== null && (
                <>
                  <dt>{text.fields.language}</dt>
                  <dd>{languageLabel(view.model.language, text.languages)}</dd>
                </>
              )}
              {view.model.voice !== null && (
                <>
                  <dt>{text.fields.voice}</dt>
                  <dd dir="ltr">{view.model.voice}</dd>
                </>
              )}
            </dl>
          </section>
        )}

        {view.tokens !== null && (
          <section className="voice-stat" aria-label={text.tokensTitle}>
            <h3>{text.tokensTitle}</h3>
            <p className="voice-big">{formatCount(locale, view.tokens.total)}</p>
            <dl>
              {view.tokens.input !== null && (
                <>
                  <dt>{text.tokens.input}</dt>
                  <dd>{formatCount(locale, view.tokens.input)}</dd>
                </>
              )}
              {view.tokens.output !== null && (
                <>
                  <dt>{text.tokens.output}</dt>
                  <dd>{formatCount(locale, view.tokens.output)}</dd>
                </>
              )}
              {view.tokens.executor !== null && (
                <>
                  <dt>{text.tokens.executor}</dt>
                  <dd>
                    {formatCount(locale, view.tokens.executor.input + view.tokens.executor.output)}{' '}
                    <small>
                      (
                      {fill(text.tokens.calls, {
                        n: formatCount(locale, view.tokens.executor.calls),
                      })}
                      )
                    </small>
                  </dd>
                </>
              )}
            </dl>
          </section>
        )}

        {view.cost !== null && (
          <section className="voice-stat" aria-label={text.costTitle}>
            <h3>{text.costTitle}</h3>
            <p className="voice-big">
              {view.cost.session === null ? (
                <span className="voice-unpriced">{text.cost.unpriced}</span>
              ) : (
                formatDollars(locale, view.cost.session)
              )}
              {view.cost.session !== null && view.cost.estimateLabel && (
                <small className="voice-estimate"> {text.cost.estimate}</small>
              )}
            </p>
            <dl>
              {view.cost.day !== null && (
                <>
                  <dt>{text.cost.day}</dt>
                  <dd>{formatDollars(locale, view.cost.day)}</dd>
                </>
              )}
              {view.cost.month !== null && (
                <>
                  <dt>{text.cost.month}</dt>
                  <dd>{formatDollars(locale, view.cost.month)}</dd>
                </>
              )}
            </dl>
            {view.cost.caps !== null && (
              <div className="voice-caps">
                <CapBar
                  label={text.cost.sessionCap}
                  percent={view.cost.caps.sessionPercent}
                  amount={view.cost.caps.sessionCapUsd}
                  locale={locale}
                  usedText={text.cost.used}
                />
                <CapBar
                  label={text.cost.dailyCap}
                  percent={view.cost.caps.dailyPercent}
                  amount={view.cost.caps.dailyCapUsd}
                  locale={locale}
                  usedText={text.cost.used}
                />
              </div>
            )}
          </section>
        )}

        {view.access !== null && (
          <section className="voice-stat" aria-label={text.accessTitle}>
            <h3>{text.accessTitle}</h3>
            <p className="voice-big">{scopeLabel(view.access.scope, text.scopes)}</p>
            {view.access.level !== null && <p>{levelLabel(view.access.level, text.levels)}</p>}
          </section>
        )}
      </div>

      <div className="voice-columns">
        <section className="voice-panel" aria-label={text.sessionsTitle}>
          <h3>{text.sessionsTitle}</h3>
          {view.sessions.length === 0 ? (
            <p className="voice-empty">{text.noSessions}</p>
          ) : (
            <ul className="voice-sessions">
              {view.sessions.map((session) => (
                <li key={session.id} className={session.current ? 'voice-current' : undefined}>
                  <span className="voice-session-time">
                    {formatClock(locale, session.startedAt)}
                  </span>
                  <span>{formatMinutes(locale, session.minutes)}</span>
                  <span>
                    {fill(text.messages, { n: formatCount(locale, session.messageCount) })}
                  </span>
                  {session.live && <span className="voice-live-tag">{text.live}</span>}
                  {session.person !== null && <span>{person(session.person.name)}</span>}
                  {session.tokens !== null && <span>{formatCount(locale, session.tokens)}</span>}
                  {session.costUsd !== null && (
                    <span>{formatDollars(locale, session.costUsd)}</span>
                  )}
                  {session.endReason !== null && (
                    <span className="voice-end">
                      {endLabel(session.endReason, text.endReasons)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {view.current !== null && view.current.lines !== null && (
          <section className="voice-panel voice-lines" aria-label={text.conversationTitle}>
            <h3>{text.conversationTitle}</h3>
            {view.current.lines.length === 0 ? (
              <p className="voice-empty">{text.noLines}</p>
            ) : (
              <ol>
                {view.current.lines.map((line, index) => (
                  <li key={`${line.at}-${index}`} className={`voice-line voice-line-${line.role}`}>
                    <span className="voice-who">
                      {line.role === 'assistant'
                        ? view.assistantName
                        : person(current?.person?.name ?? null)}
                      <small> {formatClock(locale, line.at)}</small>
                    </span>
                    <span dir="auto">{line.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        {view.current !== null && view.current.cards !== null && (
          <section className="voice-panel" aria-label={text.cardsTitle}>
            <h3>{text.cardsTitle}</h3>
            {view.current.cards.length === 0 ? (
              <p className="voice-empty">{text.noCards}</p>
            ) : (
              <ul className="voice-cards">
                {view.current.cards.map((card, index) => (
                  <ActionCard key={`${card.at}-${index}`} card={card} locale={locale} />
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function ActionCard({
  card,
  locale,
}: {
  readonly card: VoiceMonitorCard;
  readonly locale: Locale;
}) {
  const text = monitorMessages(locale).voice;
  const status = (text.cardStatus as Record<string, string>)[card.status] ?? card.status;
  return (
    <li className={`voice-card voice-card-${card.status}`}>
      <span className="voice-card-status">{status}</span>
      <span dir="auto">{card.summary}</span>
      <small>{formatClock(locale, card.at)}</small>
      {card.detail !== null && (
        <div className="voice-card-detail">
          {card.detail.targetName !== null && <p dir="auto">{card.detail.targetName}</p>}
          {card.detail.steps.length > 0 && (
            <ol aria-label={text.steps}>
              {card.detail.steps.map((step, index) => (
                <li key={index} dir="auto">
                  {step}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}

function CapBar({
  label,
  percent,
  amount,
  locale,
  usedText,
}: {
  readonly label: string;
  readonly percent: number | null;
  readonly amount: number | null;
  readonly locale: Locale;
  readonly usedText: string;
}) {
  if (percent === null && amount === null) return null;
  const hot = percent !== null && percent >= 80;
  return (
    <div className="voice-cap">
      <span>
        {label}
        {amount !== null && <> · {formatDollars(locale, amount)}</>}
      </span>
      {percent !== null && (
        <>
          <span
            className={hot ? 'voice-bar voice-bar-hot' : 'voice-bar'}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={barPercent(percent)}
          >
            <span style={{ width: `${barPercent(percent)}%` }} />
          </span>
          <small>{fill(usedText, { p: formatCount(locale, percent) })}</small>
        </>
      )}
    </div>
  );
}

const lookup = (key: string, table: Readonly<Record<string, string>>): string => table[key] ?? key;
const modeLabel = lookup;
const languageLabel = lookup;
const scopeLabel = lookup;
const levelLabel = lookup;
const endLabel = lookup;

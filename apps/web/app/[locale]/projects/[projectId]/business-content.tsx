'use client';

import { useId, useState, type ReactNode } from 'react';

import { formatDate, formatDateTime, formatNumber, type Locale } from '../../../i18n';
import { fill } from '../../agents/agent-messages';
import { businessMessages, joinList, sectionTitle } from '../business-messages';
import type { BusinessContent } from '../business-types';
import { RichText } from './rich-text';

/** The group of each profile section, in Contenter's order (the registry lives in @docoo/domain). */
const SECTION_GROUP: Readonly<Record<string, string>> = {
  OVERVIEW: 'IDENTITY',
  SERVICES: 'IDENTITY',
  VALUE_PROPOSITION: 'IDENTITY',
  COMPETITORS: 'IDENTITY',
  TARGET_MARKET: 'AUDIENCE',
  PERSONAS: 'AUDIENCE',
  FAQ: 'AUDIENCE',
  BRAND_VOICE: 'BRAND',
  BRAND_BOOK: 'BRAND',
  KEY_MESSAGES: 'BRAND',
  CONTENT_PILLARS: 'STRATEGY',
  CHANNELS: 'STRATEGY',
  GOALS: 'STRATEGY',
  CALENDAR: 'STRATEGY',
  GUIDELINES: 'RULES',
};
const GROUP_ORDER = ['IDENTITY', 'AUDIENCE', 'BRAND', 'STRATEGY', 'RULES', 'OTHER'] as const;
const SECTION_ORDER = Object.keys(SECTION_GROUP);

/** Only web addresses become links; whatever else the data holds stays plain text. */
export function safeHref(value: string): string | null {
  return /^https?:\/\/\S+$/iu.test(value) ? value : null;
}

export function Address({ value }: { readonly value: string }) {
  const href = safeHref(value);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" dir="ltr">
      {value}
    </a>
  ) : (
    <span dir="auto">{value}</span>
  );
}

function When({
  locale,
  value,
  dateOnly = false,
}: {
  readonly locale: Locale;
  readonly value: string | null;
  readonly dateOnly?: boolean;
}) {
  if (!value) return <>—</>;
  return <>{dateOnly ? formatDate(locale, value) : formatDateTime(locale, value)}</>;
}

/** A score from 0 to 100 as a ring; the number is also given as text for assistive technology. */
export function ScoreRing({
  value,
  text,
  label,
}: {
  readonly value: number;
  readonly text: string;
  readonly label: string;
}) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const tone = percent >= 80 ? 'ok' : percent >= 50 ? 'warn' : 'danger';
  return (
    <div className={`score-ring score-${tone}`} role="img" aria-label={`${label}: ${text}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <circle className="score-track" cx="50" cy="50" r={radius} />
        <circle
          className="score-value"
          cx="50"
          cy="50"
          r={radius}
          strokeDasharray={`${(circumference * percent) / 100} ${circumference}`}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <span className="score-number" aria-hidden="true">
        {text}
      </span>
    </div>
  );
}

/** A long section shows its first lines and opens on request, so the page stays scannable. */
function Collapsible({
  long,
  children,
  more,
  less,
}: {
  readonly long: boolean;
  readonly children: ReactNode;
  readonly more: string;
  readonly less: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  if (!long) return <>{children}</>;
  return (
    <>
      <div id={id} className={open ? 'clamp open' : 'clamp'}>
        {children}
      </div>
      <button
        type="button"
        className="link-button clamp-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {open ? less : more}
      </button>
    </>
  );
}

const LONG_SECTION = 520;

/** The sections of the profile, grouped, with who wrote each one and whether it is confirmed. */
export function ProfileView({
  locale,
  content,
}: {
  readonly locale: Locale;
  readonly content: BusinessContent;
}) {
  const text = businessMessages(locale);
  const profile = text.profile;
  const filled = content.sections.filter((section) => section.content.trim() !== '');
  const filledKeys = new Set(filled.map((section) => section.key));
  const emptyKeys = SECTION_ORDER.filter((key) => !filledKeys.has(key));
  const ordered = [...filled].sort((a, b) => {
    const left = SECTION_ORDER.indexOf(a.key);
    const right = SECTION_ORDER.indexOf(b.key);
    return (left === -1 ? 99 : left) - (right === -1 ? 99 : right);
  });
  const grouped = GROUP_ORDER.map((group) => ({
    group,
    sections: ordered.filter((section) => (SECTION_GROUP[section.key] ?? 'OTHER') === group),
  })).filter((item) => item.sections.length > 0);
  const drafts = filled.filter((section) => section.source === 'AI' && !section.reviewedAt).length;
  const percent = Math.round((filled.length / SECTION_ORDER.length) * 100);

  return (
    <div className="biz-profile">
      <aside className="biz-toc" aria-label={profile.contents}>
        <p className="biz-toc-title">{profile.contents}</p>
        <ul>
          {grouped.map(({ group, sections }) => (
            <li key={group}>
              <span className="biz-toc-group">{profile.groups[group] ?? group}</span>
              <ul>
                {sections.map((section) => (
                  <li key={section.key}>
                    <a href={`#biz-s-${section.key}`} dir="auto">
                      {sectionTitle(locale, section.key)}
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </aside>

      <div className="stack biz-profile-main">
        <section className="card biz-coverage" aria-labelledby="biz-coverage">
          <div className="biz-coverage-head">
            <h3 id="biz-coverage">{profile.sectionsTitle}</h3>
            <p>
              <strong>
                {fill(profile.filled, {
                  filled: formatNumber(locale, filled.length),
                  total: formatNumber(locale, SECTION_ORDER.length),
                })}
              </strong>
              {drafts > 0 && (
                <span className="muted">
                  {' · '}
                  {fill(profile.sectionStats, {
                    confirmed: formatNumber(locale, filled.length - drafts),
                    drafts: formatNumber(locale, drafts),
                  })}
                </span>
              )}
            </p>
          </div>
          <div className="meter" aria-hidden="true">
            <span style={{ inlineSize: `${percent}%` }} />
          </div>
        </section>

        {grouped.map(({ group, sections }) => (
          <section
            key={group}
            className="biz-group stack"
            aria-labelledby={`biz-group-${group}`}
            data-testid={`business-group-${group}`}
          >
            <h3 id={`biz-group-${group}`} className="biz-group-title">
              {profile.groups[group] ?? group}
            </h3>
            {sections.map((section) => {
              const draft = section.source === 'AI' && !section.reviewedAt;
              return (
                <article
                  key={section.key}
                  id={`biz-s-${section.key}`}
                  className={draft ? 'card biz-section is-draft' : 'card biz-section'}
                  data-testid={`business-section-${section.key}`}
                >
                  <header className="biz-section-head">
                    <h4 dir="auto">{sectionTitle(locale, section.key)}</h4>
                    <span className={`badge tone-${draft ? 'warn' : 'ok'}`}>
                      {draft
                        ? profile.aiDraft
                        : section.source === 'AI'
                          ? profile.confirmed
                          : profile.admin}
                    </span>
                  </header>
                  <Collapsible
                    long={section.content.length > LONG_SECTION}
                    more={profile.showMore}
                    less={profile.showLess}
                  >
                    <RichText text={section.content} />
                  </Collapsible>
                  {section.updatedAt && (
                    <p className="muted biz-section-foot">
                      {profile.updated}: <When locale={locale} value={section.updatedAt} />
                    </p>
                  )}
                </article>
              );
            })}
          </section>
        ))}

        {emptyKeys.length > 0 && (
          <section className="card biz-empty stack" aria-labelledby="biz-empty">
            <h3 id="biz-empty">{profile.emptySections}</h3>
            <p className="muted">{profile.emptySectionsHelp}</p>
            <ul className="chips" aria-label={profile.emptySections}>
              {emptyKeys.map((key) => (
                <li key={key} className="badge tone-neutral">
                  {sectionTitle(locale, key)}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card stack" aria-labelledby="biz-topics">
          <h3 id="biz-topics">{profile.topics}</h3>
          {content.topics.length === 0 ? (
            <p className="muted">{profile.noTopics}</p>
          ) : (
            <ul className="chips topic-chips">
              {content.topics.map((topic) => (
                <li key={topic.id} className="badge tone-neutral" dir="auto">
                  {topic.title}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** Key facts with their trust state, the terminology rules and the notes an admin wrote. */
export function KnowledgeView({
  locale,
  content,
  now,
}: {
  readonly locale: Locale;
  readonly content: BusinessContent;
  readonly now: number;
}) {
  const text = businessMessages(locale);
  const k = text.knowledge;
  const expired = (validUntil: string | null) =>
    validUntil !== null && new Date(validUntil).getTime() < now;
  const verified = content.facts.filter((fact) => fact.verified).length;
  const stale = content.facts.filter((fact) => expired(fact.validUntil)).length;
  const avoid = content.terms.filter((term) => term.kind === 'AVOID').length;
  const tiles: { label: string; value: number; tone?: 'ok' | 'danger' }[] = [
    { label: k.statFacts, value: content.facts.length },
    { label: k.statVerified, value: verified, tone: 'ok' },
    { label: k.statExpired, value: stale, ...(stale > 0 ? { tone: 'danger' as const } : {}) },
    { label: k.statUse, value: content.terms.length - avoid },
    { label: k.statAvoid, value: avoid },
  ];
  return (
    <div className="stack">
      <dl className="stat-tiles" aria-label={k.factsTitle}>
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className={tile.tone ? `stat-tile tone-${tile.tone}-edge` : 'stat-tile'}
          >
            <dt>{tile.label}</dt>
            <dd>{formatNumber(locale, tile.value)}</dd>
          </div>
        ))}
      </dl>
      <section className="card stack" aria-labelledby="biz-facts">
        <h3 id="biz-facts">{k.factsTitle}</h3>
        <p className="muted">{k.factsHelp}</p>
        {content.facts.length === 0 ? (
          <p className="muted">{k.noFacts}</p>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="biz-facts">
            <table data-testid="business-facts">
              <thead>
                <tr>
                  <th scope="col">{k.label}</th>
                  <th scope="col">{k.value}</th>
                  <th scope="col">{k.category}</th>
                  <th scope="col">{k.state}</th>
                  <th scope="col">{k.validUntil}</th>
                  <th scope="col">{k.source}</th>
                </tr>
              </thead>
              <tbody>
                {content.facts.map((fact, index) => {
                  const stale = expired(fact.validUntil);
                  return (
                    <tr key={`${fact.label}-${index}`}>
                      <th scope="row" dir="auto">
                        {fact.label}
                      </th>
                      <td dir="auto">{fact.value}</td>
                      <td>{k.categories[fact.category] ?? fact.category}</td>
                      <td>
                        <span className="chips">
                          <span className={`badge tone-${fact.verified ? 'ok' : 'warn'}`}>
                            {fact.verified ? k.verified : k.unverified}
                          </span>
                          {stale && <span className="badge tone-danger">{k.expired}</span>}
                          {!fact.isActive && (
                            <span className="badge tone-neutral">{k.inactive}</span>
                          )}
                        </span>
                      </td>
                      <td>
                        <When locale={locale} value={fact.validUntil} dateOnly />
                      </td>
                      <td>{fact.sourceUrl ? <Address value={fact.sourceUrl} /> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card stack" aria-labelledby="biz-terms">
        <h3 id="biz-terms">{k.termsTitle}</h3>
        <p className="muted">{k.termsHelp}</p>
        {content.terms.length === 0 ? (
          <p className="muted">{k.noTerms}</p>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="biz-terms">
            <table data-testid="business-terms">
              <thead>
                <tr>
                  <th scope="col">{k.term}</th>
                  <th scope="col">{k.kind}</th>
                  <th scope="col">{k.alternatives}</th>
                  <th scope="col">{k.note}</th>
                </tr>
              </thead>
              <tbody>
                {content.terms.map((term, index) => (
                  <tr key={`${term.term}-${index}`}>
                    <th scope="row" dir="auto">
                      {term.term}
                    </th>
                    <td>
                      <span className={`badge tone-${term.kind === 'AVOID' ? 'danger' : 'ok'}`}>
                        {k.kinds[term.kind] ?? term.kind}
                      </span>
                      {!term.isActive && <span className="badge tone-neutral">{k.inactive}</span>}
                    </td>
                    <td dir="auto">
                      {term.alternatives.length === 0 ? (
                        '—'
                      ) : (
                        <span className="chips">
                          {term.alternatives.map((alternative, position) => (
                            <span key={`${alternative}-${position}`} className="badge tone-neutral">
                              {alternative}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td dir="auto">{term.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card stack" aria-labelledby="biz-notes">
        <h3 id="biz-notes">{k.notesTitle}</h3>
        <p className="muted">{k.notesHelp}</p>
        {content.notes.length === 0 ? (
          <p className="muted">{k.noNotes}</p>
        ) : (
          <ul className="plain-list stack" data-testid="business-notes">
            {content.notes.map((note, index) => (
              <li key={`${note.createdAt}-${index}`} className="output-view">
                <RichText text={note.text} />
                {note.summary && (
                  <p className="muted" dir="auto">
                    {note.summary}
                  </p>
                )}
                <p className="muted">
                  <span className="badge tone-neutral">
                    {k.noteStatuses[note.status] ?? note.status}
                  </span>{' '}
                  {k.createdAt}: <When locale={locale} value={note.createdAt} />
                  {note.changedKeys.length > 0 && (
                    <>
                      {' · '}
                      {k.changed}:{' '}
                      {joinList(
                        locale,
                        note.changedKeys.map((key) => sectionTitle(locale, key)),
                      )}
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** What the admin gave the business as references, and the brand assets with their analysis. */
export function SourcesView({
  locale,
  content,
}: {
  readonly locale: Locale;
  readonly content: BusinessContent;
}) {
  const text = businessMessages(locale);
  const s = text.sources;
  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="biz-refs">
        <h3 id="biz-refs">{s.referencesTitle}</h3>
        <p className="muted">{s.referencesHelp}</p>
        {content.references.length === 0 ? (
          <p className="muted">{s.noReferences}</p>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="biz-refs">
            <table data-testid="business-references">
              <thead>
                <tr>
                  <th scope="col">{s.title}</th>
                  <th scope="col">{s.address}</th>
                  <th scope="col">{text.knowledge.state}</th>
                  <th scope="col">{s.chars}</th>
                  <th scope="col">{s.fetchedAt}</th>
                </tr>
              </thead>
              <tbody>
                {content.references.map((reference, index) => (
                  <tr key={`${reference.url}-${index}`}>
                    <th scope="row" dir="auto">
                      {reference.title || s.referenceKinds[reference.kind] || reference.kind}
                      {reference.excerpt && (
                        <details>
                          <summary>{s.excerpt}</summary>
                          <div className="pre-text" dir="auto">
                            {reference.excerpt}
                          </div>
                        </details>
                      )}
                    </th>
                    <td>{reference.url ? <Address value={reference.url} /> : '—'}</td>
                    <td>
                      <span className="chips">
                        <span className="badge tone-neutral">
                          {s.referenceStatuses[reference.status] ?? reference.status}
                        </span>
                        {!reference.isActive && (
                          <span className="badge tone-neutral">{s.inactive}</span>
                        )}
                      </span>
                    </td>
                    <td>{formatNumber(locale, reference.contentChars)}</td>
                    <td>
                      <When locale={locale} value={reference.fetchedAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card stack" aria-labelledby="biz-assets">
        <h3 id="biz-assets">{s.assetsTitle}</h3>
        <p className="muted">{s.assetsHelp}</p>
        {content.assets.length === 0 ? (
          <p className="muted">{s.noAssets}</p>
        ) : (
          <ul className="plain-list stack" data-testid="business-assets">
            {content.assets.map((asset, index) => (
              <li key={`${asset.title}-${index}`} className="output-view">
                <h4 dir="auto">
                  {asset.title}{' '}
                  <span className="badge tone-neutral">
                    {s.assetKinds[asset.kind] ?? asset.kind}
                  </span>{' '}
                  <span
                    className={`badge tone-${asset.analysisStatus === 'DONE' ? 'ok' : asset.analysisStatus === 'FAILED' ? 'danger' : 'neutral'}`}
                  >
                    {s.analysisStatuses[asset.analysisStatus] ?? asset.analysisStatus}
                  </span>
                  {!asset.isActive && <span className="badge tone-neutral">{s.inactive}</span>}
                </h4>
                {asset.description && <RichText text={asset.description} />}
                {(asset.url || asset.fileName) && (
                  <p>
                    {asset.url ? <Address value={asset.url} /> : null}
                    {asset.fileName && (
                      <span dir="auto">
                        {' '}
                        {s.file}: {asset.fileName}
                      </span>
                    )}
                  </p>
                )}
                {asset.analysis && (
                  <dl className="analysis-grid">
                    {Object.entries(asset.analysis).map(([key, value]) => (
                      <div key={key}>
                        <dt className="muted" dir="ltr">
                          {key}
                        </dt>
                        <dd dir="auto" className="pre-text">
                          {Array.isArray(value) ? joinList(locale, value) : value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card stack" aria-labelledby="biz-sites">
        <h3 id="biz-sites">{s.websiteSources}</h3>
        {content.business.sources.length === 0 ? (
          <p className="muted">{s.noWebsiteSources}</p>
        ) : (
          <ul className="plain-list">
            {content.business.sources.map((source, index) => (
              <li key={`${source.url}-${index}`}>
                {source.title && <span dir="auto">{source.title} — </span>}
                <Address value={source.url} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Contenter's own health score, its open checks, the latest audit and the information gaps. */
export function QualityView({
  locale,
  content,
}: {
  readonly locale: Locale;
  readonly content: BusinessContent;
}) {
  const text = businessMessages(locale);
  const q = text.quality;
  const health = content.health;
  const audit = content.audit;
  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="biz-health">
        <h3 id="biz-health">{q.healthTitle}</h3>
        {health === null ? (
          <p className="muted">{q.noHealth}</p>
        ) : (
          <>
            <div className="score-row">
              <ScoreRing
                value={health.score}
                text={formatNumber(locale, health.score)}
                label={q.healthTitle}
              />
              <div className="stack">
                <p>
                  <strong data-testid="business-health-score">
                    {fill(q.healthScore, { score: formatNumber(locale, health.score) })}
                  </strong>
                </p>
                <p className="muted">
                  {fill(q.sectionsFilled, {
                    filled: formatNumber(locale, health.filled),
                    total: formatNumber(locale, health.total),
                  })}
                </p>
                <div className="meter" aria-hidden="true">
                  <span style={{ inlineSize: `${Math.min(100, health.score)}%` }} />
                </div>
              </div>
            </div>
            <h4>{q.checksTitle}</h4>
            <ul className="plain-list stack">
              {health.checks.map((check) => (
                <li key={check.id}>
                  <span
                    className={`badge tone-${check.level === 'ok' ? 'ok' : check.level === 'warn' ? 'warn' : 'danger'}`}
                  >
                    {q.levels[check.level] ?? check.level}
                  </span>{' '}
                  <strong>{q.checks[check.id] ?? check.id}</strong>{' '}
                  <span className="muted">
                    {fill(q.count, { count: formatNumber(locale, check.count) })}
                  </span>
                  {check.keys.length > 0 && (
                    <span dir="auto">
                      {' — '}
                      {joinList(
                        locale,
                        check.keys.map((key) => sectionTitle(locale, key)),
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {content.pendingSuggestions > 0 && (
          <p className="notice" role="status">
            {q.pending}: {formatNumber(locale, content.pendingSuggestions)}
          </p>
        )}
      </section>

      <section className="card stack" aria-labelledby="biz-audit">
        <h3 id="biz-audit">{q.auditTitle}</h3>
        {audit === null ? (
          <p className="muted">{q.noAudit}</p>
        ) : (
          <>
            <p>
              {audit.score !== null && (
                <>
                  <strong>
                    {q.auditScore}: {formatNumber(locale, audit.score)}
                  </strong>{' '}
                </>
              )}
              {audit.createdAt && (
                <span className="muted">
                  {q.auditedAt}: <When locale={locale} value={audit.createdAt} />
                </span>
              )}
            </p>
            {audit.summary && <RichText text={audit.summary} />}
            {audit.strengths.length > 0 && (
              <>
                <h4>{q.strengths}</h4>
                <ul>
                  {audit.strengths.map((item, index) => (
                    <li key={`${item}-${index}`} dir="auto">
                      {item}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <h4>{q.issues}</h4>
            {audit.issues.length === 0 ? (
              <p className="muted">{q.noIssues}</p>
            ) : (
              <ul className="plain-list stack" data-testid="business-audit-issues">
                {audit.issues.map((issue, index) => (
                  <li
                    key={`${issue.title}-${index}`}
                    className={`output-view issue issue-${issue.severity.toLowerCase()}`}
                  >
                    <p>
                      <span
                        className={`badge tone-${issue.severity === 'HIGH' ? 'danger' : issue.severity === 'MEDIUM' ? 'warn' : 'neutral'}`}
                      >
                        {q.severity[issue.severity] ?? issue.severity}
                      </span>{' '}
                      <span className="badge tone-neutral">
                        {q.issueTypes[issue.type] ?? issue.type}
                      </span>{' '}
                      <span className="badge tone-neutral">
                        {q.issueStatuses[issue.status] ?? issue.status}
                      </span>{' '}
                      <strong dir="auto">{issue.title}</strong>
                    </p>
                    {issue.target && (
                      <p className="muted" dir="auto">
                        {sectionTitle(locale, issue.target)}
                      </p>
                    )}
                    {issue.detail && <RichText text={issue.detail} />}
                    {issue.fix && (
                      <p dir="auto" className="issue-fix">
                        <strong>{q.fix}:</strong> {issue.fix}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="card stack" aria-labelledby="biz-gaps">
        <h3 id="biz-gaps">{q.gapsTitle}</h3>
        {content.business.gaps.length === 0 ? (
          <p className="muted">{q.noGaps}</p>
        ) : (
          <ul>
            {content.business.gaps.map((gap, index) => (
              <li key={`${gap}-${index}`} dir="auto">
                {gap}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

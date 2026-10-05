'use client';

import { formatDateTime, formatNumber, type Locale } from '../../../i18n';
import { fill } from '../../agents/agent-messages';
import { businessMessages, joinList, sectionTitle } from '../business-messages';
import type { BusinessContent } from '../business-types';

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

function Address({ value }: { readonly value: string }) {
  const href = safeHref(value);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" dir="ltr">
      {value}
    </a>
  ) : (
    <span dir="auto">{value}</span>
  );
}

function When({ locale, value }: { readonly locale: Locale; readonly value: string | null }) {
  return <>{value ? formatDateTime(locale, value) : '—'}</>;
}

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
  const info = content.business;

  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="biz-identity">
        <h3 id="biz-identity">{info.name}</h3>
        {info.tagline && (
          <p dir="auto">
            <em>{info.tagline}</em>
          </p>
        )}
        <dl className="facts">
          {info.industry && (
            <div>
              <dt>{text.panel.industry}</dt>
              <dd dir="auto">{info.industry}</dd>
            </div>
          )}
          {info.website && (
            <div>
              <dt>{text.panel.website}</dt>
              <dd>
                <Address value={info.website} />
              </dd>
            </div>
          )}
          {info.location && (
            <div>
              <dt>{text.panel.location}</dt>
              <dd dir="auto">{info.location}</dd>
            </div>
          )}
          {info.language && (
            <div>
              <dt>{text.panel.language}</dt>
              <dd>{text.panel.languages[info.language] ?? info.language}</dd>
            </div>
          )}
          {info.status && (
            <div>
              <dt>{text.panel.status}</dt>
              <dd>{text.panel.businessStatuses[info.status] ?? info.status}</dd>
            </div>
          )}
          <div>
            <dt>{profile.sectionsTitle}</dt>
            <dd>
              {fill(profile.filled, {
                filled: formatNumber(locale, filled.length),
                total: formatNumber(locale, SECTION_ORDER.length),
              })}
            </dd>
          </div>
        </dl>
      </section>

      {grouped.map(({ group, sections }) => (
        <section
          key={group}
          className="card stack"
          aria-labelledby={`biz-group-${group}`}
          data-testid={`business-group-${group}`}
        >
          <h3 id={`biz-group-${group}`}>{profile.groups[group] ?? group}</h3>
          {sections.map((section) => (
            <details key={section.key} open data-testid={`business-section-${section.key}`}>
              <summary>
                <strong dir="auto">{sectionTitle(locale, section.key)}</strong>{' '}
                <span
                  className={`badge tone-${section.source === 'AI' && !section.reviewedAt ? 'warn' : 'ok'}`}
                >
                  {section.source === 'AI' && !section.reviewedAt
                    ? profile.aiDraft
                    : section.source === 'AI'
                      ? profile.confirmed
                      : profile.admin}
                </span>
              </summary>
              <div className="pre-text" dir="auto">
                {section.content}
              </div>
              {section.updatedAt && (
                <p className="muted">
                  {profile.updated}: <When locale={locale} value={section.updatedAt} />
                </p>
              )}
            </details>
          ))}
        </section>
      ))}

      {emptyKeys.length > 0 && (
        <section className="card stack" aria-labelledby="biz-empty">
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
          <ul className="plain-list">
            {content.topics.map((topic) => (
              <li key={topic.id} dir="auto">
                {topic.title}
              </li>
            ))}
          </ul>
        )}
      </section>
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
  return (
    <div className="stack">
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
                        <When locale={locale} value={fact.validUntil} />
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
                    <td dir="auto">{joinList(locale, term.alternatives) || '—'}</td>
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
                <p className="pre-text" dir="auto">
                  {note.text}
                </p>
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
                {asset.description && (
                  <p dir="auto" className="pre-text">
                    {asset.description}
                  </p>
                )}
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
                  <dl className="stack">
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
            <p>
              <strong data-testid="business-health-score">
                {fill(q.healthScore, { score: formatNumber(locale, health.score) })}
              </strong>{' '}
              ·{' '}
              {fill(q.sectionsFilled, {
                filled: formatNumber(locale, health.filled),
                total: formatNumber(locale, health.total),
              })}
            </p>
            <progress
              className="progress-meter"
              max={100}
              value={health.score}
              aria-label={q.healthTitle}
            />
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
            {audit.summary && (
              <p dir="auto" className="pre-text">
                {audit.summary}
              </p>
            )}
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
                  <li key={`${issue.title}-${index}`} className="output-view">
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
                    {issue.detail && (
                      <p dir="auto" className="pre-text">
                        {issue.detail}
                      </p>
                    )}
                    {issue.fix && (
                      <p dir="auto" className="pre-text">
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

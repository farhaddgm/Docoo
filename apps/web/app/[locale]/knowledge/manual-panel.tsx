'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useId, useState, type FormEvent } from 'react';

import { apiSend } from '../../api-client';
import type { Locale } from '../../i18n';
import { fill } from '../agents/agent-messages';
import { explainError, Notice, useAction } from '../use-action';
import {
  localToIso,
  ScopeEditor,
  scopesPayload,
  useScopeOptions,
  type ScopeRow,
} from './knowledge-common';
import { knowledgeMessages } from './knowledge-messages';
import {
  claimKinds,
  confidentialities,
  sourceTypes,
  type ClaimKind,
  type Confidentiality,
  type SourceType,
} from './knowledge-types';
import { manualMessages } from './manual-messages';

interface CitationDraft {
  sourceRef: string;
  title: string;
  publisher: string;
  author: string;
  publishedAt: string;
  accessedAt: string;
  locator: string;
  quote: string;
}

interface ClaimDraft {
  text: string;
  kind: ClaimKind;
  citations: CitationDraft[];
}

const emptyCitation = (): CitationDraft => ({
  sourceRef: '',
  title: '',
  publisher: '',
  author: '',
  publishedAt: '',
  accessedAt: '',
  locator: '',
  quote: '',
});

/** The same five fields the server requires for a complete citation (KNO-006). */
export function missingCitationFields(citation: CitationDraft): string[] {
  const missing: string[] = [];
  if (!citation.sourceRef.trim()) missing.push('sourceRef');
  if (!citation.title.trim()) missing.push('title');
  if (!citation.publisher.trim()) missing.push('publisher');
  if (Number.isNaN(Date.parse(citation.publishedAt))) missing.push('publishedAt');
  if (Number.isNaN(Date.parse(citation.accessedAt))) missing.push('accessedAt');
  return missing;
}

const optional = (value: string) => (value.trim() ? { value: value.trim() } : null);

/** Knowledge typed by hand with its claims and the citations of each claim (KNO-001/006). */
export function ManualKnowledgePanel({
  locale,
  workspaceId,
  onCreated,
}: {
  locale: Locale;
  workspaceId: string;
  onCreated: () => void;
}) {
  const text = knowledgeMessages(locale);
  const manual = manualMessages(locale);
  const id = useId();
  const options = useScopeOptions(workspaceId);
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, run } = useAction(explain);
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState<'fa' | 'en'>(locale);
  const [confidentiality, setConfidentiality] = useState<Confidentiality>('internal');
  const [sourceType, setSourceType] = useState<SourceType>('admin_provided');
  const [content, setContent] = useState('');
  const [declaration, setDeclaration] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [scopes, setScopes] = useState<ScopeRow[]>([
    { type: 'workspace', id: workspaceId, role: '' },
  ]);
  const [claims, setClaims] = useState<ClaimDraft[]>([]);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const claimsReady = claims.every((claim) => claim.text.trim().length > 0);
  const ready = title.trim() !== '' && content.trim() !== '' && claimsReady;

  const patchClaim = (index: number, change: Partial<ClaimDraft>) =>
    setClaims(claims.map((claim, at) => (at === index ? { ...claim, ...change } : claim)));
  const patchCitation = (claim: number, index: number, change: Partial<CitationDraft>) =>
    patchClaim(claim, {
      citations: claims[claim]!.citations.map((citation, at) =>
        at === index ? { ...citation, ...change } : citation,
      ),
    });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    const provenance = optional(declaration);
    const done = await run(async () => {
      const result = await apiSend<{ knowledge: { id: string } }>(
        'POST',
        `/workspaces/${workspaceId}/knowledge`,
        {
          title: title.trim(),
          sourceType,
          confidentiality,
          language,
          content,
          scopes: scopesPayload(scopes),
          ...(provenance ? { provenance: { declaration: provenance.value } } : {}),
          ...(localToIso(validFrom) ? { validFrom: localToIso(validFrom) } : {}),
          ...(localToIso(validUntil) ? { validUntil: localToIso(validUntil) } : {}),
          ...(claims.length > 0
            ? {
                claims: claims.map((claim) => ({
                  text: claim.text.trim(),
                  kind: claim.kind,
                  citations: claim.citations.map((citation) => ({
                    ...(citation.sourceRef.trim() ? { sourceRef: citation.sourceRef.trim() } : {}),
                    ...(citation.title.trim() ? { title: citation.title.trim() } : {}),
                    ...(citation.publisher.trim() ? { publisher: citation.publisher.trim() } : {}),
                    ...(citation.author.trim() ? { author: citation.author.trim() } : {}),
                    ...(citation.publishedAt ? { publishedAt: citation.publishedAt } : {}),
                    ...(citation.accessedAt ? { accessedAt: citation.accessedAt } : {}),
                    ...(citation.locator.trim() ? { locator: citation.locator.trim() } : {}),
                    ...(citation.quote.trim() ? { quote: citation.quote.trim() } : {}),
                  })),
                })),
              }
            : {}),
        },
      );
      setCreatedId(result.knowledge.id);
    }, '');
    if (done) {
      setTitle('');
      setContent('');
      setDeclaration('');
      setClaims([]);
      onCreated();
    }
  }

  return (
    <form className="card field-stack" onSubmit={submit} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{manual.heading}</h2>
      <p className="muted">{manual.help}</p>
      <Notice notice={notice} />
      {createdId && (
        <p className="notice ok" role="status">
          {manual.created}{' '}
          <Link href={`/${locale}/knowledge/${createdId}` as Route}>{manual.open}</Link>
        </p>
      )}

      <label htmlFor={`${id}-title`}>{manual.title}</label>
      <input
        id={`${id}-title`}
        dir="auto"
        value={title}
        maxLength={300}
        onChange={(event) => setTitle(event.target.value)}
      />
      <div className="filter-grid">
        <label htmlFor={`${id}-language`}>{manual.language}</label>
        <select
          id={`${id}-language`}
          value={language}
          onChange={(event) => setLanguage(event.target.value === 'en' ? 'en' : 'fa')}
        >
          <option value="fa">فارسی</option>
          <option value="en">English</option>
        </select>
        <label htmlFor={`${id}-confidentiality`}>{manual.confidentiality}</label>
        <select
          id={`${id}-confidentiality`}
          value={confidentiality}
          onChange={(event) => setConfidentiality(event.target.value as Confidentiality)}
        >
          {confidentialities.map((item) => (
            <option key={item} value={item}>
              {text.confidentiality[item]}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-source-type`}>{manual.sourceType}</label>
        <select
          id={`${id}-source-type`}
          value={sourceType}
          onChange={(event) => setSourceType(event.target.value as SourceType)}
        >
          {sourceTypes.map((item) => (
            <option key={item} value={item}>
              {text.sourceTypes[item]}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-from`}>{manual.validFrom}</label>
        <input
          id={`${id}-from`}
          type="datetime-local"
          value={validFrom}
          onChange={(event) => setValidFrom(event.target.value)}
        />
        <label htmlFor={`${id}-until`}>{manual.validUntil}</label>
        <input
          id={`${id}-until`}
          type="datetime-local"
          value={validUntil}
          onChange={(event) => setValidUntil(event.target.value)}
        />
      </div>

      <label htmlFor={`${id}-content`}>{manual.content}</label>
      <p id={`${id}-content-help`} className="muted">
        {manual.contentHelp}
      </p>
      <textarea
        id={`${id}-content`}
        dir="auto"
        rows={8}
        value={content}
        aria-describedby={`${id}-content-help`}
        onChange={(event) => setContent(event.target.value)}
      />
      <label htmlFor={`${id}-declaration`}>{manual.declaration}</label>
      <p id={`${id}-declaration-help`} className="muted">
        {manual.declarationHelp}
      </p>
      <textarea
        id={`${id}-declaration`}
        dir="auto"
        rows={2}
        maxLength={2000}
        value={declaration}
        aria-describedby={`${id}-declaration-help`}
        onChange={(event) => setDeclaration(event.target.value)}
      />

      <ScopeEditor
        rows={scopes}
        onChange={setScopes}
        workspaceId={workspaceId}
        options={options}
        text={text}
        disabled={busy}
      />

      <fieldset className="field-stack">
        <legend>{manual.claimsHeading}</legend>
        <p className="muted">{manual.claimsHelp}</p>
        <ul className="plain-list stack">
          {claims.map((claim, index) => {
            const n = String(index + 1);
            return (
              <li key={`${id}-claim-${index}`} className="card field-stack">
                <h3>{fill(manual.claimN, { n })}</h3>
                <label htmlFor={`${id}-claim-${index}-text`}>
                  {fill(manual.claimN, { n })}: {manual.claimText}
                </label>
                <textarea
                  id={`${id}-claim-${index}-text`}
                  dir="auto"
                  rows={2}
                  maxLength={2000}
                  value={claim.text}
                  onChange={(event) => patchClaim(index, { text: event.target.value })}
                />
                <label htmlFor={`${id}-claim-${index}-kind`}>
                  {fill(manual.claimN, { n })}: {manual.claimKind}
                </label>
                <select
                  id={`${id}-claim-${index}-kind`}
                  value={claim.kind}
                  onChange={(event) => patchClaim(index, { kind: event.target.value as ClaimKind })}
                >
                  {claimKinds.map((kind) => (
                    <option key={kind} value={kind}>
                      {text.claimKinds[kind]}
                    </option>
                  ))}
                </select>
                <ul className="plain-list stack">
                  {claim.citations.map((citation, at) => {
                    const missing = missingCitationFields(citation);
                    const label = fill(manual.citationN, { n: String(at + 1), c: n });
                    const field = (
                      name: keyof CitationDraft,
                      caption: string,
                      type: 'text' | 'date' = 'text',
                    ) => (
                      <>
                        <label htmlFor={`${id}-claim-${index}-cit-${at}-${name}`}>
                          {label}: {caption}
                        </label>
                        <input
                          id={`${id}-claim-${index}-cit-${at}-${name}`}
                          type={type}
                          dir={type === 'text' ? 'auto' : undefined}
                          maxLength={type === 'text' ? 2048 : undefined}
                          value={citation[name]}
                          onChange={(event) =>
                            patchCitation(index, at, { [name]: event.target.value })
                          }
                        />
                      </>
                    );
                    return (
                      <li key={`${id}-claim-${index}-cit-${at}`} className="field-stack">
                        {field('sourceRef', manual.sourceRef)}
                        {field('title', manual.citationTitle)}
                        {field('publisher', manual.publisher)}
                        {field('author', manual.author)}
                        {field('publishedAt', manual.publishedAt, 'date')}
                        {field('accessedAt', manual.accessedAt, 'date')}
                        {field('locator', manual.locator)}
                        {field('quote', manual.quote)}
                        <p className="muted" role="status">
                          {missing.length === 0
                            ? manual.complete
                            : fill(manual.missing, {
                                fields: missing
                                  .map((name) => manual.fields[name] ?? name)
                                  .join(locale === 'fa' ? '، ' : ', '),
                              })}
                        </p>
                        <p>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={busy}
                            onClick={() =>
                              patchClaim(index, {
                                citations: claim.citations.filter((_, i) => i !== at),
                              })
                            }
                          >
                            {fill(manual.removeCitation, { n: String(at + 1), c: n })}
                          </button>
                        </p>
                      </li>
                    );
                  })}
                </ul>
                <p className="toolbar">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || claim.citations.length >= 20}
                    onClick={() =>
                      patchClaim(index, { citations: [...claim.citations, emptyCitation()] })
                    }
                  >
                    {fill(manual.addCitation, { c: n })}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => setClaims(claims.filter((_, at) => at !== index))}
                  >
                    {fill(manual.removeClaim, { n })}
                  </button>
                </p>
              </li>
            );
          })}
        </ul>
        <p>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || claims.length >= 500}
            onClick={() => setClaims([...claims, { text: '', kind: 'statement', citations: [] }])}
          >
            {manual.addClaim}
          </button>
        </p>
      </fieldset>

      {!ready && (
        <p className="muted">
          {title.trim() === '' || content.trim() === ''
            ? manual.needTitleAndText
            : manual.needClaimText}
        </p>
      )}
      <div className="toolbar">
        <button className="primary-button" type="submit" disabled={!ready || busy}>
          {busy ? manual.submitting : manual.submit}
        </button>
      </div>
    </form>
  );
}

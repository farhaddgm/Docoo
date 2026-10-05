import { formatNumber, type Locale } from '../../../i18n';
import { editorMessages, fill } from './editor-messages';

export interface TermIssueView {
  readonly kind: 'USE' | 'AVOID';
  readonly term: string;
  readonly found: string;
  readonly count: number;
  readonly replaceWith?: readonly string[] | undefined;
  readonly note?: string | undefined;
}

/**
 * Where a document breaks the brand terminology of the business (ADR-0021). The server finds
 * them by code, not by a model, so a listed break is really in the text.
 */
export function TermIssues({
  locale,
  issues,
  level = 'h4',
}: {
  readonly locale: Locale;
  readonly issues: readonly TermIssueView[] | undefined;
  readonly level?: 'h4' | 'h5';
}) {
  const text = editorMessages(locale);
  if (!issues || issues.length === 0) return null;
  const Heading = level;
  return (
    <section aria-labelledby={`term-issues-${level}`} data-testid="term-issues">
      <Heading id={`term-issues-${level}`}>{text.termTitle}</Heading>
      <p className="muted">{text.termHelp}</p>
      <ul className="plain-list">
        {issues.map((issue, index) => (
          <li key={`${issue.kind}-${issue.term}-${issue.found}-${index}`} dir="auto">
            <span className={`badge tone-${issue.kind === 'AVOID' ? 'danger' : 'warn'}`}>
              {issue.kind === 'AVOID' ? text.termAvoidBadge : text.termUseBadge}
            </span>{' '}
            {fill(issue.kind === 'AVOID' ? text.termAvoid : text.termUse, {
              term: issue.term,
              found: issue.found,
              n: formatNumber(locale, issue.count),
            })}
            {issue.replaceWith && issue.replaceWith.length > 0 && (
              <>
                {' '}
                {text.termReplaceWith}: <strong>{issue.replaceWith.join(' / ')}</strong>
              </>
            )}
            {issue.note && <span className="muted"> — {issue.note}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

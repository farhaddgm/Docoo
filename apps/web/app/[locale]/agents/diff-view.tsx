import type { AgentMessages } from './agent-messages';
import type { DiffLine } from './diff';

export function DiffView({ lines, text }: { lines: readonly DiffLine[]; text: AgentMessages }) {
  const marker = { same: ' ', added: '+', removed: '−' } as const;
  const label = { same: text.unchanged, added: text.added, removed: text.removed } as const;
  return (
    <ul className="diff">
      {lines.map((line, index) => (
        <li key={`${index}-${line.kind}`} className={`diff-line diff-${line.kind}`}>
          <span aria-hidden="true" className="diff-marker">
            {marker[line.kind]}
          </span>
          <span className="visually-hidden">{label[line.kind]}: </span>
          <span dir="auto">{line.text}</span>
        </li>
      ))}
    </ul>
  );
}

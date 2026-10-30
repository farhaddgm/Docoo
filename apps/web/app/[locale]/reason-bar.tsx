'use client';

import type { ReactNode } from 'react';

import { FieldLabel } from '../info-tip';
import { textDir, type Locale } from '../i18n';

/**
 * The "reason for the change" every settings-like change asks for: the label, the field and the
 * buttons that save the change sit on one line (they wrap on a narrow screen), instead of a
 * label over a field over a row of buttons. The label stays a real `<label>` of the field.
 */
export function ReasonBar({
  locale,
  id,
  label,
  help,
  value,
  onChange,
  maxLength = 1000,
  minLength,
  required = false,
  disabled = false,
  invalid = false,
  children,
}: {
  locale: Locale;
  id: string;
  label: string;
  /** The "i" explanation next to the label; the field lists it in `aria-describedby`. */
  help?: string | undefined;
  value: string;
  onChange: (next: string) => void;
  maxLength?: number;
  minLength?: number;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  /** The buttons that go with the field (save, reset, confirm, cancel). */
  children?: ReactNode;
}) {
  const helpId = `${id}-help`;
  return (
    <div className="reason-bar">
      <FieldLabel htmlFor={id} help={help} helpId={helpId}>
        {label}
      </FieldLabel>
      <input
        id={id}
        className="reason-input"
        dir={textDir(locale)}
        value={value}
        maxLength={maxLength}
        {...(minLength !== undefined ? { minLength } : {})}
        required={required}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={help ? helpId : undefined}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
      {children && <div className="reason-actions">{children}</div>}
    </div>
  );
}

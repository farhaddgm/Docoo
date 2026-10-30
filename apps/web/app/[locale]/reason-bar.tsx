'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { FieldLabel } from '../info-tip';
import { textDir, type Locale } from '../i18n';

const closeLabel: Record<Locale, string> = { fa: 'بستن', en: 'Close' };

const penIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
    <path d="m13.5 6.5 4 4" />
  </svg>
);

/**
 * The "reason for the change" every settings-like change asks for. The reason itself is typed in a
 * small dialog opened by a pen button, so the row holds only that button and the buttons that save
 * the change. The field stays inside the surrounding form, and when the form cannot be submitted
 * because the reason is missing or too short, the dialog opens by itself on that field.
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
  /** The "i" explanation next to the title; the field lists it in `aria-describedby`. */
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
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const filled = value.trim() !== '';
  const flagged = invalid || (required && !filled);
  return (
    <div className="reason-bar">
      <button
        type="button"
        className={`reason-pen${filled ? ' filled' : ''}${flagged ? ' flagged' : ''}`}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {penIcon}
      </button>
      <dialog
        ref={dialog}
        className="reason-dialog"
        aria-labelledby={`${id}-title`}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialog.current) setOpen(false);
        }}
      >
        <div className="reason-dialog-head">
          <span id={`${id}-title`}>
            <FieldLabel htmlFor={id} help={help} helpId={helpId}>
              {label}
            </FieldLabel>
          </span>
          <button type="button" className="secondary-button" onClick={() => setOpen(false)}>
            {closeLabel[locale]}
          </button>
        </div>
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
          onInvalid={() => setOpen(true)}
        />
      </dialog>
      {children && <div className="reason-actions">{children}</div>}
    </div>
  );
}

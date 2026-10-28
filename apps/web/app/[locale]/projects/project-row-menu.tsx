'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { direction, type Locale } from '../../i18n';

export type RowCommand = 'archive' | 'delete';

/**
 * The three-dot button at the end of a project row. It opens a small menu of the lifecycle
 * commands the row's project accepts (archive, delete); picking one hands it to the page, which
 * asks for the confirmation the project page asks for too. The menu is drawn outside the table,
 * which clips and scrolls.
 */
export function ProjectRowMenu({
  locale,
  label,
  commands,
  labels,
  disabled,
  onChoose,
}: {
  locale: Locale;
  /** Names the button for assistive technology, with the project it belongs to. */
  label: string;
  commands: readonly RowCommand[];
  labels: Record<string, string>;
  disabled: boolean;
  onChoose: (command: RowCommand) => void;
}) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; inline: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const position = () => {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const rtl = document.documentElement.dir === 'rtl';
      setPlace({
        top: rect.bottom + 4,
        inline: rtl ? rect.left : window.innerWidth - rect.right,
      });
    };
    position();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open]);

  // Focus moves into the menu once it is drawn, not each time it is placed again.
  const placed = place !== null;
  useEffect(() => {
    if (open && placed) popupRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, placed]);

  if (commands.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="row-menu-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>
      {open &&
        place &&
        createPortal(
          <div
            id={menuId}
            ref={popupRef}
            className="account-menu row-menu"
            role="menu"
            aria-label={label}
            dir={direction(locale)}
            style={{ top: place.top, insetInlineEnd: place.inline }}
            onKeyDown={(event) => {
              const items = [
                ...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'),
              ];
              const index = items.indexOf(document.activeElement as HTMLElement);
              if (event.key === 'ArrowDown') items[(index + 1) % items.length]?.focus();
              else if (event.key === 'ArrowUp')
                items[(index - 1 + items.length) % items.length]?.focus();
              else return;
              event.preventDefault();
            }}
          >
            {commands.map((command) => (
              <button
                key={command}
                type="button"
                role="menuitem"
                data-command={command}
                className={
                  command === 'delete'
                    ? 'account-menu-item account-menu-danger'
                    : 'account-menu-item'
                }
                onClick={() => {
                  setOpen(false);
                  onChoose(command);
                }}
              >
                <span>{labels[command] ?? command}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

'use client';

import { useEffect, useId, type ReactNode } from 'react';

import type { Locale } from './i18n';
import { useLocale } from './locale-context';

const helpLabel: Record<Locale, string> = { fa: 'راهنما', en: 'Help' };

/**
 * The "i" button that carries a field's explanation. The text sits in a hidden element the
 * button (and, through `aria-describedby`, the field) points at, so assistive technology reads
 * it in place; sighted users see it in the shared tooltip that `InfoTipHost` draws on hover,
 * keyboard focus or tap.
 */
export function InfoTip({
  text,
  id,
}: {
  /** The explanation. Plain text: it is shown in a tooltip. */
  readonly text: string;
  /** A stable id so the field can list it in `aria-describedby`. */
  readonly id?: string;
}) {
  const locale = useLocale();
  const generated = useId();
  const textId = id ?? `tip-${generated.replaceAll(':', '')}`;
  return (
    <span className="info-tip">
      <button
        type="button"
        className="info-tip-button"
        aria-label={helpLabel[locale]}
        aria-describedby={textId}
        aria-expanded="false"
        data-info-tip={textId}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M12 11v5.5M12 7.5h.01" />
        </svg>
      </button>
      <span id={textId} hidden>
        {text}
      </span>
    </span>
  );
}

/**
 * A field title with its optional "i" explanation next to it. `helpId` is the id the field lists
 * in `aria-describedby`.
 */
export function FieldLabel({
  htmlFor,
  help,
  helpId,
  children,
}: {
  readonly htmlFor: string;
  readonly help?: string | undefined;
  readonly helpId?: string;
  readonly children: ReactNode;
}) {
  return (
    <span className="field-label">
      <label htmlFor={htmlFor}>{children}</label>
      {help ? <InfoTip text={help} {...(helpId ? { id: helpId } : {})} /> : null}
    </span>
  );
}

/**
 * The title of a group of controls (a fieldset legend, a radio set) with its "i" explanation.
 * Unlike `FieldLabel` it is not a `<label>`: the group has no single control to point at.
 */
export function GroupLabel({
  help,
  helpId,
  children,
}: {
  readonly help?: string | undefined;
  readonly helpId?: string;
  readonly children: ReactNode;
}) {
  return (
    <span className="field-label">
      <span>{children}</span>
      {help ? <InfoTip text={help} {...(helpId ? { id: helpId } : {})} /> : null}
    </span>
  );
}

/** A heading with the "i" explanation of what the section is for, for a block that is not a field. */
export function SectionTitle({
  as: Heading = 'h2',
  id,
  help,
  helpId,
  children,
}: {
  readonly as?: 'h2' | 'h3' | 'h4';
  readonly id?: string;
  readonly help?: string | undefined;
  readonly helpId?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="section-title">
      <Heading {...(id ? { id } : {})}>{children}</Heading>
      {help ? <InfoTip text={help} {...(helpId ? { id: helpId } : {})} /> : null}
    </div>
  );
}

const TOOLTIP_ID = 'docoo-info-tooltip';
const HIDE_DELAY_MS = 160;

/**
 * One tooltip for every "i" button, drawn outside any card or scroll area and kept inside the
 * viewport. It opens on hover and keyboard focus, stays open when the button is tapped or
 * clicked, and closes with Escape, a click elsewhere, scrolling away or a resize. Mounted once
 * in the root layout; the buttons themselves are plain server-renderable markup.
 */
export function InfoTipHost() {
  useEffect(() => {
    let tooltip: HTMLDivElement | null = null;
    let anchor: HTMLElement | null = null;
    let pinned = false;
    let leaveTimer: ReturnType<typeof setTimeout> | undefined;

    const triggerOf = (node: EventTarget | null): HTMLElement | null =>
      node instanceof Element ? node.closest<HTMLElement>('.info-tip-button') : null;

    function ensureTooltip(): HTMLDivElement {
      if (tooltip) return tooltip;
      tooltip = document.createElement('div');
      tooltip.id = TOOLTIP_ID;
      // The same words are already the button's accessible description; do not read them twice.
      tooltip.setAttribute('aria-hidden', 'true');
      tooltip.hidden = true;
      tooltip.addEventListener('pointerenter', () => clearTimeout(leaveTimer));
      tooltip.addEventListener('pointerleave', () => {
        if (!pinned) hide();
      });
      document.body.appendChild(tooltip);
      return tooltip;
    }

    function hide() {
      clearTimeout(leaveTimer);
      if (tooltip) tooltip.hidden = true;
      anchor?.setAttribute('aria-expanded', 'false');
      anchor = null;
      pinned = false;
    }

    function position() {
      if (!tooltip || tooltip.hidden || !anchor) return;
      const box = anchor.getBoundingClientRect();
      const tip = tooltip.getBoundingClientRect();
      const rtl = document.documentElement.dir === 'rtl';
      const left = Math.max(
        12,
        Math.min(rtl ? box.right - tip.width : box.left, window.innerWidth - tip.width - 12),
      );
      const below = box.bottom + 8;
      const candidate =
        below + tip.height <= window.innerHeight - 12 ? below : box.top - tip.height - 8;
      const top = Math.max(12, Math.min(candidate, window.innerHeight - tip.height - 12));
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    }

    function show(button: HTMLElement, pin: boolean) {
      const source = document.getElementById(button.dataset['infoTip'] ?? '')?.textContent?.trim();
      if (!source) return;
      clearTimeout(leaveTimer);
      const element = ensureTooltip();
      if (anchor && anchor !== button) hide();
      anchor = button;
      pinned = pin;
      element.textContent = source;
      element.dir = document.documentElement.dir;
      element.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      position();
    }

    const onPointerOver = (event: PointerEvent) => {
      const button = triggerOf(event.target);
      if (button && !button.contains(event.relatedTarget as Node | null)) show(button, false);
    };
    const onPointerOut = (event: PointerEvent) => {
      const button = triggerOf(event.target);
      if (
        button &&
        button === anchor &&
        !button.contains(event.relatedTarget as Node | null) &&
        !pinned
      ) {
        leaveTimer = setTimeout(() => {
          if (document.activeElement !== anchor) hide();
        }, HIDE_DELAY_MS);
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      const button = triggerOf(event.target);
      if (button) show(button, false);
      else if (!tooltip?.contains(event.target as Node)) hide();
    };
    const onFocusOut = (event: FocusEvent) => {
      const button = triggerOf(event.target);
      if (button && button === anchor && !pinned && !button.matches(':hover')) hide();
    };
    const onClick = (event: MouseEvent) => {
      const button = triggerOf(event.target);
      if (button) {
        event.preventDefault();
        if (anchor === button && pinned) hide();
        else show(button, true);
      } else if (!tooltip?.contains(event.target as Node)) hide();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && anchor) {
        // Close only the tip: a dialog around the field must not also close on this key press.
        event.stopImmediatePropagation();
        hide();
      }
    };
    const onScroll = (event: Event) => {
      if (tooltip?.contains(event.target as Node)) return;
      if (anchor && (pinned || document.activeElement === anchor || anchor.matches(':hover')))
        position();
      else hide();
    };

    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('pointerout', onPointerOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', hide);
    return () => {
      clearTimeout(leaveTimer);
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', hide);
      tooltip?.remove();
    };
  }, []);

  return null;
}

'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

interface NavItem {
  readonly id: string;
  readonly label: string;
}

/** The text of the heading an element is labelled by, without the help button next to it. */
/**
 * The label a block names itself with. A bare `data-nav` attribute reaches the page as the text
 * "true", which is a marker and never a name.
 */
export function explicitLabel(value: string | null): string {
  const text = value?.trim() ?? '';
  return text === '' || text === 'true' ? '' : text;
}

function headingText(element: HTMLElement): string {
  const explicit = explicitLabel(element.getAttribute('data-nav'));
  if (explicit) return explicit;
  const labelledBy = element.getAttribute('aria-labelledby');
  const heading = labelledBy ? document.getElementById(labelledBy.split(' ')[0] ?? '') : null;
  if (!heading) return '';
  const clone = heading.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.info-tip, [hidden]').forEach((node) => node.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function sameItems(a: readonly NavItem[], b: readonly NavItem[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, i) => item.id === b[i]?.id && item.label === b[i]?.label)
  );
}

/**
 * A tab's content with a side list of its blocks, like the business profile. A block is any
 * element inside marked with `data-nav` (its label is the heading it is labelled by, or the
 * attribute's own value); the list follows the page as blocks load, appear and go.
 */
export function SectionNav({ label, children }: { label: string; children: ReactNode }) {
  const prefix = useId().replace(/:/g, '');
  const mainRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<readonly NavItem[]>([]);
  const [active, setActive] = useState('');

  useEffect(() => {
    const root = mainRef.current;
    if (!root) return;
    let frame = 0;
    const scan = () => {
      const found: NavItem[] = [];
      root.querySelectorAll<HTMLElement>('[data-nav]').forEach((element, index) => {
        const text = headingText(element);
        if (!text) return;
        if (!element.id) element.id = `nav-${prefix}-${index}`;
        found.push({ id: element.id, label: text });
      });
      setItems((current) => (sameItems(current, found) ? current : found));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(scan);
    };
    scan();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [prefix]);

  // The block nearest the top of the window is the current one.
  useEffect(() => {
    if (items.length < 2 || typeof IntersectionObserver === 'undefined') return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = items.find((item) => visible.has(item.id));
        if (first) setActive(first.id);
      },
      { rootMargin: '0px 0px -65% 0px' },
    );
    for (const item of items) {
      const element = document.getElementById(item.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [items]);

  const withNav = items.length >= 2;
  return (
    <div className={withNav ? 'biz-profile stage-nav' : 'stage-nav'}>
      {withNav && (
        <aside className="biz-toc" aria-label={label}>
          <p className="biz-toc-title">{label}</p>
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  aria-current={active === item.id ? 'true' : undefined}
                  onClick={(event) => {
                    const target = document.getElementById(item.id);
                    if (!target) return;
                    event.preventDefault();
                    setActive(item.id);
                    target.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      )}
      <div ref={mainRef} className="stack biz-profile-main">
        {children}
      </div>
    </div>
  );
}

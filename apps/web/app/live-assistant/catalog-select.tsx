'use client';

import { useState } from 'react';

const OTHER = '__other__';

/**
 * Picks one value from a provider's catalog. A native `<datalist>` only offers what matches the
 * text already typed and shows no sign that a list exists, so a filled field looked like it had
 * no choices. This is a real list that is always fully visible; "other" opens a text field for a
 * value that is not in the catalog (a new model, a private voice).
 */
export function CatalogSelect({
  id,
  value,
  options,
  preferred,
  chooseLabel,
  otherLabel,
  maxLength = 200,
  onChange,
}: {
  readonly id: string;
  readonly value: string;
  /** Catalog entries: the value saved and, when it differs, a label to show. */
  readonly options: readonly { readonly value: string; readonly label?: string }[];
  /** Entries that match are listed first (e.g. realtime models), the rest follow. */
  readonly preferred?: (value: string) => boolean;
  readonly chooseLabel: string;
  readonly otherLabel: string;
  readonly maxLength?: number;
  readonly onChange: (value: string) => void;
}) {
  const [manual, setManual] = useState(false);
  const known = options.some((item) => item.value === value);
  // A saved value the catalog does not list, or an empty catalog, is shown as typed text.
  const typing = manual || options.length === 0 || (value !== '' && !known);

  const render = (items: readonly { value: string; label?: string }[]) =>
    items.map((item) => (
      <option key={item.value} value={item.value}>
        {item.label ?? item.value}
      </option>
    ));
  const first = preferred ? options.filter((item) => preferred(item.value)) : [];
  const rest = preferred ? options.filter((item) => !preferred(item.value)) : options;

  return (
    <>
      {options.length > 0 && (
        <select
          id={id}
          dir="ltr"
          value={typing ? OTHER : value}
          onChange={(event) => {
            if (event.target.value === OTHER) {
              setManual(true);
              return;
            }
            setManual(false);
            onChange(event.target.value);
          }}
        >
          <option value="">{chooseLabel}</option>
          {render(first)}
          {render(rest)}
          <option value={OTHER}>{otherLabel}</option>
        </select>
      )}
      {typing && (
        <input
          id={options.length === 0 ? id : `${id}-manual`}
          type="text"
          maxLength={maxLength}
          dir="ltr"
          aria-label={otherLabel}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </>
  );
}

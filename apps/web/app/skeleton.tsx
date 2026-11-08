import type { CSSProperties, ReactNode } from 'react';

/**
 * Placeholders shown while a page or a panel loads: grey shapes where the content will be, so the
 * page keeps its size and nothing jumps when the data arrives. Plain markup and one shared style
 * (`.skeleton` in globals.css); no library and no script.
 *
 * Each one is a polite status region that names what is loading for screen readers, and its
 * shapes are hidden from them.
 */

/** A bare shape; give it a size with `width`/`height` or one of the `skeleton-*` classes. */
export function Skeleton({
  className = '',
  width,
  height,
}: {
  readonly className?: string;
  readonly width?: string;
  readonly height?: string;
}) {
  const style: CSSProperties = {};
  if (width) style.inlineSize = width;
  if (height) style.blockSize = height;
  return <span className={`skeleton ${className}`.trim()} style={style} aria-hidden="true" />;
}

/** The wrapper every placeholder shares: announces `label`, marks the area busy. */
export function LoadingRegion({
  label,
  className = '',
  children,
}: {
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className={`skeleton-region ${className}`.trim()} role="status" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      {children}
    </div>
  );
}

/** Lines of text, the last one shorter. */
export function TextSkeleton({
  label,
  lines = 3,
}: {
  readonly label: string;
  readonly lines?: number;
}) {
  return (
    <LoadingRegion label={label} className="skeleton-lines">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className="skeleton-line" />
      ))}
    </LoadingRegion>
  );
}

/** A card with a title and a few lines: the shape of most panels. */
export function PanelSkeleton({
  label,
  lines = 4,
}: {
  readonly label: string;
  readonly lines?: number;
}) {
  return (
    <LoadingRegion label={label} className="card skeleton-panel">
      <Skeleton className="skeleton-title" />
      <div className="skeleton-lines">
        {Array.from({ length: lines }, (_, index) => (
          <Skeleton key={index} className="skeleton-line" />
        ))}
      </div>
    </LoadingRegion>
  );
}

/** Several panels one under the other, for a tab that holds a few blocks. */
export function PanelsSkeleton({
  label,
  count = 3,
}: {
  readonly label: string;
  readonly count?: number;
}) {
  return (
    <LoadingRegion label={label} className="stack">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="card skeleton-panel" aria-hidden="true">
          <Skeleton className="skeleton-title" />
          <div className="skeleton-lines">
            <Skeleton className="skeleton-line" />
            <Skeleton className="skeleton-line" />
            <Skeleton className="skeleton-line" />
          </div>
        </div>
      ))}
    </LoadingRegion>
  );
}

/** A table: a head row and `rows` rows of `cols` cells. */
export function TableSkeleton({
  label,
  rows = 5,
  cols = 4,
}: {
  readonly label: string;
  readonly rows?: number;
  readonly cols?: number;
}) {
  const columns = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` };
  return (
    <LoadingRegion label={label} className="skeleton-table">
      <div className="skeleton-table-row skeleton-table-head" style={columns} aria-hidden="true">
        {Array.from({ length: cols }, (_, cell) => (
          <Skeleton key={cell} className="skeleton-cell-head" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="skeleton-table-row" style={columns} aria-hidden="true">
          {Array.from({ length: cols }, (_, cell) => (
            <Skeleton key={cell} className="skeleton-cell" />
          ))}
        </div>
      ))}
    </LoadingRegion>
  );
}

/** A list of rows with a round mark and two lines each. */
export function ListSkeleton({
  label,
  rows = 4,
}: {
  readonly label: string;
  readonly rows?: number;
}) {
  return (
    <LoadingRegion label={label} className="skeleton-list">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton-list-row" aria-hidden="true">
          <Skeleton className="skeleton-dot" />
          <div className="skeleton-lines">
            <Skeleton className="skeleton-line" />
            <Skeleton className="skeleton-line" />
          </div>
        </div>
      ))}
    </LoadingRegion>
  );
}

/** A grid of small cards (figures, tiles). */
export function TilesSkeleton({
  label,
  count = 4,
}: {
  readonly label: string;
  readonly count?: number;
}) {
  return (
    <LoadingRegion label={label} className="skeleton-tiles">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="card skeleton-tile" aria-hidden="true">
          <Skeleton className="skeleton-line" />
          <Skeleton className="skeleton-figure" />
        </div>
      ))}
    </LoadingRegion>
  );
}

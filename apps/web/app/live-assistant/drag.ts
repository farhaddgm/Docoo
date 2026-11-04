/** Dragging the floating pill: where it may sit and when a press counts as a drag. */

export const DRAG_THRESHOLD = 4;
export const VIEWPORT_MARGIN = 8;

export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Keeps the whole pill inside the window, however small the window gets. */
export function clampPosition(point: Point, size: Size, viewport: Size): Point {
  const room = (inner: number, outer: number) =>
    Math.max(VIEWPORT_MARGIN, outer - inner - VIEWPORT_MARGIN);
  return {
    x: Math.min(Math.max(VIEWPORT_MARGIN, point.x), room(size.width, viewport.width)),
    y: Math.min(Math.max(VIEWPORT_MARGIN, point.y), room(size.height, viewport.height)),
  };
}

/** A press that barely moves is a click, not a drag. */
export const isDrag = (dx: number, dy: number): boolean => Math.hypot(dx, dy) >= DRAG_THRESHOLD;

/** Reads a stored position defensively: anything malformed or off any real screen is ignored. */
export function parsePosition(raw: string | null): Point | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { x, y } = value as Record<string, unknown>;
  const sane = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 20_000;
  return sane(x) && sane(y) ? { x, y } : null;
}

export interface Rect {
  x: number;
  /** In the city this is the z axis. */
  y: number;
  w: number;
  h: number;
}

export interface TreemapItem<T> {
  item: T;
  value: number;
}

export interface TreemapCell<T> {
  item: T;
  rect: Rect;
}

function worst(row: number[], side: number): number {
  let sum = 0;
  let min = Infinity;
  let max = 0;
  for (const a of row) {
    sum += a;
    if (a < min) min = a;
    if (a > max) max = a;
  }
  const s2 = sum * sum;
  const side2 = side * side;
  return Math.max((side2 * max) / s2, s2 / (side2 * min));
}

/**
 * Squarified treemap (Bruls, Huizing & van Wijk). Lays the items into `rect`
 * with areas proportional to their values, keeping cells close to square.
 * Items should already be sorted by value, largest first.
 */
export function squarify<T>(items: TreemapItem<T>[], rect: Rect): TreemapCell<T>[] {
  const out: TreemapCell<T>[] = [];
  const total = items.reduce((s, i) => s + Math.max(i.value, 0), 0);
  if (items.length === 0 || total <= 0 || rect.w <= 0 || rect.h <= 0) return out;

  const scale = (rect.w * rect.h) / total;
  const areas = items.map((i) => Math.max(i.value, 0) * scale);
  let free: Rect = { ...rect };
  let row: number[] = [];
  let rowStart = 0;

  const placeRow = (start: number, areasInRow: number[]) => {
    const sum = areasInRow.reduce((s, a) => s + a, 0);
    if (free.w >= free.h) {
      // Lay the row as a column on the left edge.
      const colW = Math.min(free.w, sum / free.h);
      let y = free.y;
      areasInRow.forEach((a, k) => {
        const h = colW > 0 ? a / colW : 0;
        out.push({ item: items[start + k].item, rect: { x: free.x, y, w: colW, h } });
        y += h;
      });
      free = { x: free.x + colW, y: free.y, w: Math.max(0, free.w - colW), h: free.h };
    } else {
      // Lay the row as a strip along the top edge.
      const rowH = Math.min(free.h, sum / free.w);
      let x = free.x;
      areasInRow.forEach((a, k) => {
        const w = rowH > 0 ? a / rowH : 0;
        out.push({ item: items[start + k].item, rect: { x, y: free.y, w, h: rowH } });
        x += w;
      });
      free = { x: free.x, y: free.y + rowH, w: free.w, h: Math.max(0, free.h - rowH) };
    }
  };

  let i = 0;
  while (i < areas.length) {
    const side = Math.min(free.w, free.h);
    const a = areas[i];
    if (row.length === 0 || worst([...row, a], side) <= worst(row, side)) {
      row.push(a);
      i++;
    } else {
      placeRow(rowStart, row);
      rowStart = i;
      row = [];
    }
  }
  if (row.length) placeRow(rowStart, row);
  return out;
}

export function shrink(rect: Rect, by: number): Rect {
  const b = Math.min(by, rect.w / 2 - 0.01, rect.h / 2 - 0.01);
  const m = Math.max(0, b);
  return { x: rect.x + m, y: rect.y + m, w: rect.w - 2 * m, h: rect.h - 2 * m };
}

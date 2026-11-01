export function fuzzyScore(query: string, text: string): number | null {
  const qs = Array.from(query.toLowerCase()), raw = Array.from(text), ts = raw.map((c) => c.toLowerCase()), m = qs.length, n = ts.length;
  if (!m) return 0;
  if (m > n) return null;
  const opens = (j: number): boolean => j === 0 || /[\s>\-/(.,:_]/.test(raw[j - 1]) || (raw[j] !== ts[j] && raw[j - 1] === ts[j - 1] && /[a-z]/.test(ts[j - 1]));
  let prev = new Float64Array(n).fill(-Infinity), row = new Float64Array(n);
  for (let i = 0; i < m; i++) {
    let earlier = -Infinity;
    for (let j = 0; j < n; j++) {
      if (j >= 2) earlier = Math.max(earlier, prev[j - 2]);
      if (ts[j] !== qs[i]) { row[j] = -Infinity; continue; }
      const own = 1 + (opens(j) ? 5 : 0) - j * 0.01, before = i === 0 ? 0 : Math.max(j >= 1 ? prev[j - 1] + 7 : -Infinity, earlier);
      row[j] = before === -Infinity ? -Infinity : before + own;
    }
    [prev, row] = [row, prev];
  }
  let best = -Infinity;
  for (let j = 0; j < n; j++) best = Math.max(best, prev[j]);
  return best === -Infinity ? null : Math.round(best) - Math.floor(n / 8);
}

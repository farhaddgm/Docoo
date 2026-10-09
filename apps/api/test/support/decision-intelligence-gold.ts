/** Pinned synthetic bilingual smoke corpus; relevance is curated, not inferred by the engine. */
export const retrievalGold = [
  {
    key: 'churn',
    fa: 'ریزش مشتری کاهش یافت',
    en: 'Customer churn decreased',
    queries: { fa: 'ریزش مشتری', en: 'customer churn' },
  },
  {
    key: 'inventory',
    fa: 'موجودی انبار و تحویل بهتر شد',
    en: 'Inventory stock and delivery improved',
    queries: { fa: 'موجودی تحویل', en: 'inventory delivery' },
  },
  {
    key: 'budget',
    fa: 'بودجه آموزش کارکنان افزایش یافت',
    en: 'Employee training budget increased',
    queries: { fa: 'بودجه آموزش', en: 'budget training' },
  },
  {
    key: 'security',
    fa: 'امنیت و حریم خصوصی داده بهبود یافت',
    en: 'Data security and privacy improved',
    queries: { fa: 'امنیت حریم خصوصی', en: 'security privacy' },
  },
  {
    key: 'sales',
    fa: 'درآمد فروش و سود افزایش یافت',
    en: 'Sales revenue and profit increased',
    queries: { fa: 'درآمد فروش', en: 'sales revenue' },
  },
  {
    key: 'quality',
    fa: 'کیفیت محصول و بهره وری بهبود یافت',
    en: 'Product quality and productivity improved',
    queries: { fa: 'کیفیت محصول', en: 'product quality' },
  },
] as const;

export function retrievalMetrics(ids: readonly string[], relevant: ReadonlySet<string>) {
  const top = ids.slice(0, 10);
  const dcg = top.reduce(
    (sum, id, index) => sum + (relevant.has(id) ? 1 / Math.log2(index + 2) : 0),
    0,
  );
  const ideal = Array.from(
    { length: Math.min(10, relevant.size) },
    (_, i) => 1 / Math.log2(i + 2),
  ).reduce((a, b) => a + b, 0);
  return { recall: top.filter((id) => relevant.has(id)).length / relevant.size, ndcg: dcg / ideal };
}

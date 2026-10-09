/** Fixed endpoint, bounded inputs/output, no redirects, and redacted failures. */
export async function createOpenAiEmbeddings(input: {
  apiKey: string;
  model: string;
  texts: readonly string[];
  fetcher?: typeof fetch;
  timeoutMs?: number;
}) {
  if (
    !input.apiKey ||
    !input.model ||
    input.texts.length < 1 ||
    input.texts.length > 65 ||
    input.texts.some((text) => !text.trim() || new TextEncoder().encode(text).byteLength > 6000) ||
    input.texts.reduce((sum, text) => sum + new TextEncoder().encode(text).byteLength, 0) > 240000
  )
    throw new Error('EMBEDDING_INVALID_INPUT');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 15000);
  try {
    const response = await (input.fetcher ?? fetch)('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: input.model, input: input.texts, encoding_format: 'float' }),
    });
    if (!response.ok || !response.body) throw new Error();
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 4000000) throw new Error();
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('data' in payload) ||
      !Array.isArray(payload.data) ||
      payload.data.length !== input.texts.length
    )
      throw new Error();
    const vectors = new Map<number, number[]>();
    let dimensions: number | null = null;
    for (const raw of payload.data as unknown[]) {
      if (!raw || typeof raw !== 'object' || !('index' in raw) || !('embedding' in raw))
        throw new Error();
      const { index, embedding } = raw;
      if (
        typeof index !== 'number' ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= input.texts.length ||
        vectors.has(index) ||
        !Array.isArray(embedding) ||
        embedding.length < 1 ||
        embedding.length > 4096 ||
        embedding.some((n: unknown) => typeof n !== 'number' || !Number.isFinite(n)) ||
        Math.hypot(...(embedding as number[])) === 0
      )
        throw new Error();
      dimensions ??= embedding.length;
      if (dimensions !== embedding.length) throw new Error();
      vectors.set(index, embedding as number[]);
    }
    return input.texts.map((_, index) => vectors.get(index)!);
  } catch {
    throw new Error('EMBEDDING_PROVIDER_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}

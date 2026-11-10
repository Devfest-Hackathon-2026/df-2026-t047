import type { EmbeddingPort } from '../../application/ports.ts';

/** @google/genai の models.embedContent と同じ形（テストで差し替えられるよう構造的に定義） */
export interface EmbedContentClient {
  models: {
    embedContent(params: {
      model: string;
      contents: string[];
      config?: Record<string, unknown>;
    }): Promise<{ embeddings?: { values?: number[] }[] }>;
  };
}

/**
 * Gemini の埋め込み（ADR-0009）。案の文章を 256 次元にして、似ている案の判定と好みとの近さに使う。
 * ベクトルは大きいので保存せず、メモリにだけ置く。
 */
export class GeminiEmbedding implements EmbeddingPort {
  readonly name = 'gemini-embedding';

  constructor(
    private readonly client: EmbedContentClient,
    private readonly model: string,
    private readonly dims = 256,
    private readonly log: (m: string) => void = () => {},
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const started = Date.now();
    const res = await this.client.models.embedContent({
      model: this.model,
      contents: texts,
      config: { outputDimensionality: this.dims, taskType: 'SEMANTIC_SIMILARITY', abortSignal: AbortSignal.timeout(8000) },
    });
    const out = (res.embeddings ?? []).map((e) => normalize(e.values ?? []));
    if (out.length !== texts.length || out.some((v) => v.length === 0)) throw new Error('embedding count mismatch');
    this.log(`[ai] embed ok ${Date.now() - started}ms model=${this.model} n=${texts.length}`);
    return out;
  }
}

/** 次元を落とした埋め込みは長さ1になっていないので、そろえてから使う */
function normalize(v: number[]) {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

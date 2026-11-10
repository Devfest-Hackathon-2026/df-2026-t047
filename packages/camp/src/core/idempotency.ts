/**
 * 二重処理の防止（§5.2）。(送り手, commandId) ごとに結果を覚え、同じ組が来たら同じ結果を返す。
 * 上限は**送り手ごと**（古いものから捨てる。挿入順の Map を使った簡易 LRU）。
 * 部屋全体で上限を共有すると、ほかの人の操作が多いときに自分の結果が押し出され、
 * 送り直しが二重に実行される（bench/ の S1 で見つけた。docs/experiments/2026-11-10-camp-vs-conventional-results.md）。
 * 参加者の数には上限があるので、覚える量も 参加者 × limit で頭打ちになる。
 */
export class ResultCache<R> {
  private bySender = new Map<string, Map<string, R>>();

  constructor(private readonly limit = 500) {}

  get(senderId: string, commandId: string): R | undefined {
    return this.bySender.get(senderId)?.get(commandId);
  }

  set(senderId: string, commandId: string, result: R) {
    let m = this.bySender.get(senderId);
    if (!m) this.bySender.set(senderId, (m = new Map()));
    m.set(commandId, result);
    if (m.size > this.limit) m.delete(m.keys().next().value!);
  }

  get size() {
    let n = 0;
    for (const m of this.bySender.values()) n += m.size;
    return n;
  }
}

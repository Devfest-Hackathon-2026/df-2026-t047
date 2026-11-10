import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ResultCache, SeqGate } from '../src/core/index.ts';

const src = join(import.meta.dirname, '../src');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
const importsOf = (file: string) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);

describe('@camp-protocol/kit の境界（ADR-0010 §5）', () => {
  it('どのファイルも IDEA AUDITION（@idea-audition/*）を import しない', () => {
    for (const f of files(src)) for (const spec of importsOf(f)) expect(spec.startsWith('@idea-audition'), `${f} → ${spec}`).toBe(false);
  });

  it('core/ はブラウザでも動くよう zod と core/ の中だけを import する', () => {
    for (const f of files(join(src, 'core'))) {
      for (const spec of importsOf(f)) expect(spec === 'zod' || spec.startsWith('./'), `${f} → ${spec}`).toBe(true);
    }
  });

  it('client/ は Node 専用のもの（ws・node:*）を import しない', () => {
    for (const f of files(join(src, 'client'))) {
      for (const spec of importsOf(f)) expect(spec === 'ws' || spec.startsWith('node:'), `${f} → ${spec}`).toBe(false);
    }
  });

  it('ResultCache：同じ送り手と commandId には同じ結果、送り手ごとの上限を超えたら古いものから捨てる', () => {
    const c = new ResultCache<string>(2);
    c.set('a', '1', 'ok');
    c.set('b', '1', 'ng');
    expect(c.get('a', '1')).toBe('ok');
    expect(c.get('b', '1')).toBe('ng');
    c.set('a', '2', 'x');
    expect(c.get('a', '1')).toBe('ok');
    c.set('a', '3', 'y');
    expect(c.get('a', '1')).toBeUndefined();
    expect(c.get('a', '2')).toBe('x');
    expect(c.size).toBe(3);
  });

  it('ResultCache：ほかの人の操作が多くても、自分の結果は押し出されない', () => {
    const c = new ResultCache<string>(3);
    c.set('a', 'mine', 'ok');
    for (let i = 0; i < 100; i++) c.set('b', String(i), 'ok');
    expect(c.get('a', 'mine')).toBe('ok');
  });

  it('SeqGate：古い・重複した seq を捨て、snapshot で数え直す', () => {
    const g = new SeqGate();
    expect(g.accept(3)).toBe(true);
    expect(g.accept(3)).toBe(false);
    expect(g.accept(4)).toBe(true);
    g.reset(10);
    expect(g.accept(9)).toBe(false);
    expect(g.accept(11)).toBe(true);
  });
});

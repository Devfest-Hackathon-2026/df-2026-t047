import { describe, expect, it } from 'vitest';
import { findProposalLetter } from '../src/domain/proposal-letter.ts';

describe('findProposalLetter（A案・B案での呼びかけ）', () => {
  it('「A案」「案B」「Cの案」「エー案」「ビー案」を記号の番号にする', () => {
    expect(findProposalLetter('A案の費用は？')).toBe(0);
    expect(findProposalLetter('案Bはどう？')).toBe(1);
    expect(findProposalLetter('Cの案がいいと思う')).toBe(2);
    expect(findProposalLetter('エー案の対象は誰？')).toBe(0);
    expect(findProposalLetter('ビー案もう少し安くして')).toBe(1);
    expect(findProposalLetter('Ｄ案')).toBe(3);
  });

  it('いちばん先に出てきた記号を使う', () => {
    expect(findProposalLetter('B案よりA案のほうがいい')).toBe(1);
  });

  it('記号の呼びかけでなければ null（英単語の一部や記号のない「案」は拾わない）', () => {
    expect(findProposalLetter('この案いいね')).toBeNull();
    expect(findProposalLetter('BBQ案はどう？')).toBeNull();
    expect(findProposalLetter('コストを下げたい')).toBeNull();
  });
});

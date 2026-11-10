/**
 * 会議の模型（4つの作りで共通）。IDEA AUDITION の会議を、通信の比較に要る形だけに縮めたもの。
 *  - REACT：反応（数を1つ増やす。賛成・いいねの代わり）
 *  - ASK：質問（AI が数秒かけて答える。呼ぶたびにお金がかかる）
 *  - NEXT：次の提案へ（質問と答えを片づける。前の提案への答えは、もう出してはいけない）
 *
 * 操作には計測用の opId を付ける。サーバーはこれを「重複を捨てる」ためには使わない（それは作りごとの守り）。
 * 台帳（Ledger）は計測だけのためのもので、どの作りでも同じように「実際に何回反映したか」を数える。
 */

export type Op =
  | { type: 'REACT'; opId: string }
  | { type: 'ASK'; opId: string; text: string }
  | { type: 'NEXT'; opId: string };

export interface Question {
  id: string;
  by: string;
  text: string;
  proposal: number;
}

export interface MeetingState {
  proposal: number;
  reactions: number;
  questions: Question[];
  answers: { questionId: string; proposal: number; text: string }[];
  /** 直近に反映した操作（画面に出たかを計測で見分けるため）。どの作りでも同じものを配る */
  recent: string[];
}

const RECENT_MAX = 300;

export const initialMeeting = (): MeetingState => ({ proposal: 1, reactions: 0, questions: [], answers: [], recent: [] });

/** 計測用の台帳：何回反映したか・AI を何回呼んだか・古い答えを何回出したか */
export class Ledger {
  applied = new Map<string, number>();
  aiCalls = 0;
  staleAnswers = 0;
  answers = 0;

  record(opId: string) {
    this.applied.set(opId, (this.applied.get(opId) ?? 0) + 1);
  }
}

function remember(s: MeetingState, opId: string) {
  s.recent.push(opId);
  if (s.recent.length > RECENT_MAX) s.recent.splice(0, s.recent.length - RECENT_MAX);
}

/** 操作を1件反映する。質問なら、AI に頼む質問を返す（頼むのは呼び出し側） */
export function applyOp(s: MeetingState, op: Op, actor: string, ledger: Ledger): Question | null {
  ledger.record(op.opId);
  remember(s, op.opId);
  switch (op.type) {
    case 'REACT':
      s.reactions++;
      return null;
    case 'ASK': {
      const q = { id: op.opId, by: actor, text: op.text, proposal: s.proposal };
      s.questions.push(q);
      return q;
    }
    case 'NEXT':
      s.proposal++;
      s.questions = [];
      s.answers = [];
      return null;
  }
}

/** AI の答えを反映する。いまの提案と違う提案への答えなら「古い答えを出した」と数える */
export function applyAnswer(s: MeetingState, q: Question, text: string, ledger: Ledger) {
  ledger.answers++;
  if (q.proposal !== s.proposal) ledger.staleAnswers++;
  s.answers.push({ questionId: q.id, proposal: q.proposal, text });
}

/** NEXT の状態（CAMP は room.reset でこれに置き換える） */
export function nextState(s: MeetingState): MeetingState {
  return { ...s, proposal: s.proposal + 1, questions: [], answers: [] };
}

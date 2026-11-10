import { z } from 'zod';

/**
 * 優勝した案の企画書（第1部）。Gemini が作る。
 * 第2部の審査レポートは記録（snapshot）からそのまま作るので、ここには含めない。
 */
export const ProposalContent = z.object({
  title: z.string(),
  /** 一言でいうと（キャッチコピー） */
  catchphrase: z.string(),
  background: z.string(),
  problem: z.string(),
  target: z.string(),
  value: z.string(),
  overview: z.string(),
  features: z.array(z.object({ name: z.string(), detail: z.string() })),
  plan: z.array(z.object({ phase: z.string(), period: z.string(), tasks: z.string() })),
  resources: z.string(),
  budget: z.string(),
  risks: z.array(z.object({ risk: z.string(), mitigation: z.string() })),
  kpis: z.array(z.string()),
  nextActions: z.array(z.string()),
  /** 審査では確かめていない前提（要検証） */
  assumptions: z.array(z.string()),
  /** 企画内容に基づき生成されたキービジュアル画像（data URL または URL）。省略・null 可 */
  imageUrl: z.string().nullable().optional(),
});
export type ProposalContent = z.infer<typeof ProposalContent>;

export const ProposalView = z.object({
  status: z.enum(['generating', 'ready', 'failed']),
  content: ProposalContent.nullable(),
  generatedAt: z.string().nullable(),
  /** 作成に使ったAI（gemini / fixture）。固定データのときは画面に注記する */
  generatedBy: z.string().nullable(),
});
export type ProposalView = z.infer<typeof ProposalView>;

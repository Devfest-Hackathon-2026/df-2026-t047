import { GoogleGenAI } from '@google/genai';
import { localAuthClient } from '../gcp-auth.ts';
import type { GeminiConfig } from './gemini-gateway.ts';

/**
 * Vertex AI 用のクライアント。APIキーは使わない。
 * 認証は gcp-auth.ts を参照（Cloud Run ではサービスアカウント、ローカルでは gcloud の設定）。
 */
export function createVertexClient(env: NodeJS.ProcessEnv, location = env.GOOGLE_CLOUD_LOCATION ?? 'global') {
  const project = env.GOOGLE_CLOUD_PROJECT;
  if (!project) throw new Error('GOOGLE_CLOUD_PROJECT が未設定です');
  const authClient = localAuthClient(env);
  return new GoogleGenAI({
    vertexai: true,
    project,
    location,
    ...(authClient ? { googleAuthOptions: { authClient, projectId: project } } : {}),
  });
}

export function geminiConfigFromEnv(env: NodeJS.ProcessEnv): GeminiConfig {
  return {
    fast: {
      model: env.GEMINI_MODEL_FAST ?? 'gemini-3.5-flash',
      thinkingLevel: (env.GEMINI_THINKING_FAST as GeminiConfig['fast']['thinkingLevel']) ?? 'MINIMAL',
      timeoutMs: Number(env.GEMINI_TIMEOUT_FAST_MS ?? 12_000),
    },
    refine: {
      model: env.GEMINI_MODEL_REFINE ?? 'gemini-3.8-flash',
      thinkingLevel: (env.GEMINI_THINKING_REFINE as GeminiConfig['refine']['thinkingLevel']) ?? 'LOW',
      timeoutMs: Number(env.GEMINI_TIMEOUT_REFINE_MS ?? 25_000),
    },
    image: {
      // Imagen は Vertex で提供が終わっている（3.0・4.0 とも見つからない）。Gemini の画像モデルの軽い版（約5秒・約270KB の JPEG）
      model: env.GEMINI_MODEL_IMAGE ?? 'gemini-3.1-flash-lite-image',
      timeoutMs: Number(env.GEMINI_TIMEOUT_IMAGE_MS ?? 25_000),
    },
  };
}

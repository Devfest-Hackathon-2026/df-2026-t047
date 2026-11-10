import { currentFocus } from '../../scene/focus.ts';
import { create } from 'zustand';
import { useDisplay } from '../../store/display-store.ts';
import { useSession } from '../../store/session-store.ts';
import { VoiceClient, type VoiceState } from './voice-client.ts';
import { callMicrophone } from '../call/call-store.ts';

interface VoiceStore {
  state: VoiceState;
  toggle(): void;
  /** 文字起こしを始める・止める（通話のミュートと連動させる） */
  setActive(on: boolean): void;
}

let client: VoiceClient | null = null;

export const useVoice = create<VoiceStore>((set, get) => {
  const getClient = () =>
    (client ??= new VoiceClient({
      onState: (state, reason) => {
        set({ state });
        const on = state === 'listening' || state === 'starting';
        useSession.getState().client?.sendEphemeral('MIC_STATE_CHANGED', { on });
        if (state === 'unavailable' && reason) useDisplay.getState().toast(reason, 'warn');
      },
      // 「うーん」の声：見ているキャラへの迷いとしてサーバーに知らせる（返事なし、ADR-0010 の Signal）
      onHum: (e) => {
        const { hover, detail } = currentFocus();
        const target = detail ?? hover;
        if (!target) return;
        useSession.getState().client?.sendSignal({
          kind: 'hesitation',
          targetInstanceId: target,
          cue: 'うーん（声）',
          features: { silenceMs: Math.round(e.silenceMs), rms: Math.round(e.rms * 1000) / 1000 },
        });
      },
    }));

  // 詳細を開いているキャラを、名前を言わなかったときの宛先にする
  useDisplay.subscribe((s, prev) => {
    if (s.selected !== prev.selected) client?.setTarget(s.selected);
  });

  return {
    state: 'off',
    setActive(on) {
      const { state } = get();
      const active = state === 'listening' || state === 'starting';
      if (on !== active) get().toggle();
    },
    toggle() {
      const c = getClient();
      const { state } = get();
      if (state === 'listening' || state === 'starting') {
        c.stop();
        return;
      }
      const { sessionId, judgeId } = useSession.getState();
      if (!judgeId) return;
      c.setTarget(useDisplay.getState().selected);
      // 通話中なら、通話のマイクを使い回す（もう一度マイクを開くと、iPhone などで通話の声が止まる）
      void c.start(sessionId, judgeId, callMicrophone());
    },
  };
});

import { useDisplay } from '../store/display-store.ts';
import { copyText } from './copy-text.ts';

const INVITE_TEXT = 'IDEA AUDITION に招待されました。このリンクから一緒に審査しよう！';

type ShareNavigator = Navigator & { share?: (d: ShareData) => Promise<void>; canShare?: (d: ShareData) => boolean };

const shareData = (url: string) => ({ title: 'IDEA AUDITION', text: INVITE_TEXT, url });

/** この端末・ブラウザに共有シートがあるか（ない環境では「招待」ボタンを出さず、コピーだけにする） */
export function canShareInvite(url: string = location.href): boolean {
  const nav = navigator as ShareNavigator;
  return !!nav.share && (!nav.canShare || nav.canShare(shareData(url)));
}

/** 招待：端末の共有シート（AirDrop・LINE・メッセージ・メールなど、端末にあるもの）で部屋のリンクを送る */
export async function shareInvite(url: string = location.href): Promise<void> {
  const nav = navigator as ShareNavigator;
  if (!canShareInvite(url)) {
    await copyInvite(url);
    return;
  }
  try {
    await nav.share!(shareData(url));
  } catch (e) {
    if ((e as DOMException).name !== 'AbortError') await copyInvite(url); // 閉じただけなら何もしない
  }
}

export async function copyInvite(url: string = location.href): Promise<boolean> {
  const ok = await copyText(url);
  if (ok) useDisplay.getState().toast('招待リンクをコピーしました');
  else useDisplay.getState().toast(`コピーできませんでした。このリンクを送ってください：${url}`, 'warn');
  return ok;
}

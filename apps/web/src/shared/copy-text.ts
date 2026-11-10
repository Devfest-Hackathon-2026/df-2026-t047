/**
 * 文字をクリップボードにコピーする。navigator.clipboard が断られた環境（古いブラウザ・アプリの中の表示など）では、
 * 一時的なテキスト欄を選んでコピーする昔の方法で試す。どちらもだめなら false。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

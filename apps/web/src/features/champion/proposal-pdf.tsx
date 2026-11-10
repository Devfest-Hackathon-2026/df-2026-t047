import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { CHARACTER_DESIGNS, type SessionSnapshot } from '@idea-audition/protocol';
import { ProposalDocument } from './ProposalDocument.tsx';

/**
 * 企画書＋審査レポートを PDF にしてダウンロードする。
 * ブラウザの中で紙面を描いて画像化するので、日本語フォントをそのまま使え、サーバーに重い処理を足さない。
 * （文字は画像になるため PDF 上で選択できない。必要なら将来サーバー側生成に切り替える）
 */
export async function downloadProposalPdf(snapshot: SessionSnapshot) {
  const content = snapshot.proposal?.content;
  if (!content || !snapshot.champion) throw new Error('proposal not ready');

  const host = document.createElement('div');
  // 画面外に置いて描画する（display:none だと描けないため）
  host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;background:#ffffff;';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<ProposalDocument snapshot={snapshot} content={content} />));
    await document.fonts?.ready;
    await waitForImages(host);
    const { default: html2pdf } = await import('html2pdf.js');
    const filename = `IDEA_AUDITION_企画書_${sanitize(content.title)}.pdf`;
    // pagebreak は型定義に無いが html2pdf.js の正式なオプション
    const options: Record<string, unknown> = {
      margin: [10, 0, 12, 0],
      filename,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      // 行の途中でページが切れないよう、表の行・段落・2列の段・箇条書き・カード・数字の並びを、まとまりごとに次のページへ送る
      pagebreak: {
        mode: ['css', 'legacy'],
        avoid: ['tr', 'li', 'h2', '[data-keep]', '.keep'],
      },
    };
    await html2pdf()
      .set(options as never)
      .from(host.firstElementChild as HTMLElement)
      .save();
  } finally {
    root.unmount();
    host.remove();
  }
}

function sanitize(s: string) {
  return s.replace(/[\/:*?"<>|\s]+/g, '_').slice(0, 40);
}

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function waitForImages(el: HTMLElement) {
  // マスコットはスプライトシート背景画像なので、html2canvas でも位置ずれなく確実に描けるよう1体ずつ切り出した画像に差し替える
  const mascotNodes = [...el.querySelectorAll<HTMLElement>('[data-mascot-design]')];
  const sheetCache = new Map<string, HTMLImageElement | null>();
  for (const node of mascotNodes) {
    const id = Number(node.dataset.mascotDesign ?? '0');
    const design = CHARACTER_DESIGNS[id] ?? CHARACTER_DESIGNS[0]!;
    const { sheet, col, row, cols, rows } = design.sprite;
    if (!sheetCache.has(sheet)) {
      sheetCache.set(sheet, await loadImage(sheet));
    }
    const img = sheetCache.get(sheet);
    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
      const cellW = Math.floor(img.naturalWidth / cols);
      const cellH = Math.floor(img.naturalHeight / rows);
      const canvas = document.createElement('canvas');
      canvas.width = cellW;
      canvas.height = cellH;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, col * cellW, row * cellH, cellW, cellH, 0, 0, cellW, cellH);
        node.style.backgroundImage = `url(${canvas.toDataURL('image/png')})`;
        node.style.backgroundSize = '100% 100%';
        node.style.backgroundPosition = '0 0';
      }
    }
  }

  const urls = new Set<string>();
  el.querySelectorAll<HTMLElement>('[style*="background-image"]').forEach((n) => {
    const m = n.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
    if (m?.[1] && !m[1].startsWith('data:')) urls.add(m[1]);
  });
  await Promise.all([...urls].map((src) => loadImage(src)));

  // 企画イメージ画像（data URL / SVG / 外部 URL）のデコード完了を待ち、SVG data URL は html2canvas 向けに PNG 化する
  const imgs = [...el.querySelectorAll<HTMLImageElement>('img')];
  for (const imgNode of imgs) {
    const src = imgNode.getAttribute('src') || imgNode.src;
    if (!src) continue;
    const loaded = await loadImage(src);
    if (loaded && src.startsWith('data:image/svg+xml') && loaded.naturalWidth > 0 && loaded.naturalHeight > 0) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = loaded.naturalWidth;
        canvas.height = loaded.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(loaded, 0, 0);
          imgNode.src = canvas.toDataURL('image/png');
        }
      } catch {
        // canvas 変換できない環境では元の data URL をそのまま使う
      }
    }
  }
}

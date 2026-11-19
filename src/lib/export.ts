import type { ExportResult } from './protocol';

/** 比較画像では元データと印刷再現を左右に並べ、それぞれの左上に名前を入れる */
export function toPng(result: ExportResult, labels: [string, string]) {
  const { w, h, left, right } = result;
  const gap = left ? Math.round(w * 0.02) : 0;
  const canvas = document.createElement('canvas');
  canvas.width = left ? w * 2 + gap : w;
  canvas.height = h;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, h);
  context.putImageData(new ImageData(right, w, h), left ? w + gap : 0, 0);
  if (left) {
    context.putImageData(new ImageData(left, w, h), 0, 0);
    const size = Math.max(14, Math.round(w * 0.026)), pad = Math.round(size * 0.5);
    context.font = `600 ${size}px system-ui, sans-serif`;
    context.textBaseline = 'middle';
    labels.forEach((label, i) => {
      const x = i * (w + gap) + pad, width = context.measureText(label).width + pad * 2;
      context.fillStyle = 'rgba(0,0,0,.6)';
      context.fillRect(x, pad, width, size + pad * 2);
      context.fillStyle = '#fff';
      context.fillText(label, x + pad, pad * 2 + size / 2);
    });
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('png'))), 'image/png');
  });
}

export function download(url: string, name: string) {
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
}

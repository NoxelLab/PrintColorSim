import type { DisplaySpace } from './protocol';

const canvasSpace = (space: DisplaySpace) => (space === 'p3' ? 'display-p3' : 'srgb');

function detect(): DisplaySpace {
  try {
    if (!matchMedia('(color-gamut: p3)').matches) return 'srgb';
    const context = document.createElement('canvas').getContext('2d', { colorSpace: 'display-p3' });
    return context?.getContextAttributes().colorSpace === 'display-p3' ? 'p3' : 'srgb';
  } catch {
    return 'srgb';
  }
}

/** 画面が表示できる色空間。P3 に対応した画面と canvas がそろう場合だけ P3 を使う。 */
export const displaySpace = detect();

export function paint(canvas: HTMLCanvasElement, pixels: Uint8ClampedArray<ArrayBuffer>, w: number, h: number, space: DisplaySpace) {
  const colorSpace = canvasSpace(space);
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d', { colorSpace })!.putImageData(new ImageData(pixels, w, h, { colorSpace }), 0, 0);
}

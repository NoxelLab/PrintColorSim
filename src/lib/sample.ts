/** 彩度の高い色を多く含むサンプルのポスターを PNG として生成する */
export function sample() {
  const canvas = Object.assign(document.createElement('canvas'), { width: 1200, height: 1600 });
  const x = canvas.getContext('2d')!;
  x.scale(2, 2);
  const rect = (fill: string | CanvasGradient, a: number, b: number, w: number, h: number) => { x.fillStyle = fill; x.fillRect(a, b, w, h); };
  const disc = (fill: string | CanvasGradient, a: number, b: number, r: number) => { x.fillStyle = fill; x.beginPath(); x.arc(a, b, r, 0, 7); x.fill(); };
  const text = (fill: string, font: string, value: string, a: number, b: number, align: CanvasTextAlign = 'left') => {
    x.fillStyle = fill; x.font = `${font} Arial,Helvetica,sans-serif`; x.textAlign = align; x.fillText(value, a, b);
  };
  const hill = (fill: string, y: number, a: number, b: number) => {
    x.fillStyle = fill; x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(180, y - a, 380, y + b, 600, y - 30); x.lineTo(600, 800); x.lineTo(0, 800); x.fill();
  };

  const sky = x.createLinearGradient(0, 0, 0, 700);
  sky.addColorStop(0, '#1414ff'); sky.addColorStop(0.5, '#1f8fff'); sky.addColorStop(1, '#c4efff');
  rect(sky, 0, 0, 600, 800);
  const sun = x.createRadialGradient(380, 260, 10, 410, 300, 165);
  sun.addColorStop(0, '#fff200'); sun.addColorStop(1, '#ff5400');
  disc(sun, 410, 300, 165);
  disc('#ff0a8c', 130, 380, 62);
  hill('#00e85a', 500, 90, 60); hill('#7a1cff', 575, 80, 70); hill('#ff2a2a', 640, 60, 50);
  rect('#f3eee4', 0, 700, 600, 100);
  text('#fff', '900 92px', 'COLOR', 36, 112); text('#fff', '900 92px', 'FES', 36, 196);
  text('#2a2a2a', '900 34px', '2027.8.14 SAT', 36, 762); text('#6b6b6b', '400 22px', 'OPEN 11:00', 564, 760, 'right');

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('sample'))), 'image/png');
  });
}

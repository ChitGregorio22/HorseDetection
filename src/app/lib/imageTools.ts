/** Turn a picture (camera frame, uploaded file) into the website's photo format:
 *  JPEG ~80 %, longest side 1280 px (like the Pi's photos) + a ~400 px thumbnail for the cards. */
export interface PreparedPhoto {
  image: string;
  thumb: string;
  width: number;
  height: number;
}

function drawScaled(src: CanvasImageSource, w: number, h: number, maxSide: number, quality: number) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot process photos.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, cw, ch);
  return { url: canvas.toDataURL('image/jpeg', quality), cw, ch };
}

export function preparePhoto(src: CanvasImageSource, w: number, h: number): PreparedPhoto {
  const big = drawScaled(src, w, h, 1280, 0.8);
  const small = drawScaled(src, w, h, 400, 0.72);
  return { image: big.url, thumb: small.url, width: big.cw, height: big.ch };
}

/** Load an uploaded file (JPEG / PNG / HEIC where the browser can show it). Phone photos are turned upright. */
export function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name} isn't a picture this browser can open (try a JPEG or PNG).`));
    };
    img.src = url;
  });
}

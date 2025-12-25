export interface CoverPalette {
  dominant: string;
  vibrant: string;
  dark: string;
  light: string;
}

const paletteCache = new Map<string, Promise<CoverPalette | null>>();

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function parseRgb(color: string): { r: number; g: number; b: number } {
  const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (match) {
    return {
      r: parseInt(match[1] || "0", 10),
      g: parseInt(match[2] || "0", 10),
      b: parseInt(match[3] || "0", 10),
    };
  }
  return { r: 20, g: 20, b: 30 };
}

export function getPaletteFromImage(url?: string): Promise<CoverPalette | null> {
  if (!url) return Promise.resolve(null);

  const existing = paletteCache.get(url);
  if (existing) return existing;

  const task = new Promise<CoverPalette | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const w = 64;
        const h = 64;
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);

        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;

        let r = 0,
          g = 0,
          b = 0,
          n = 0;
        let maxBrightness = 0,
          minBrightness = 255;
        let vibrantR = 0,
          vibrantG = 0,
          vibrantB = 0,
          maxSaturation = 0;
        let darkR = 0,
          darkG = 0,
          darkB = 0;
        let lightR = 0,
          lightG = 0,
          lightB = 0;

        for (let i = 0; i < data.length; i += 4) {
          const rr = data[i] ?? 0;
          const gg = data[i + 1] ?? 0;
          const bb = data[i + 2] ?? 0;
          const aa = data[i + 3] ?? 0;
          if (aa < 16) continue;

          r += rr;
          g += gg;
          b += bb;
          n++;

          const brightness = (rr + gg + bb) / 3;
          const saturation = Math.max(rr, gg, bb) - Math.min(rr, gg, bb);

          if (saturation > maxSaturation && brightness > 50 && brightness < 200) {
            maxSaturation = saturation;
            vibrantR = rr;
            vibrantG = gg;
            vibrantB = bb;
          }

          if (brightness > maxBrightness) {
            maxBrightness = brightness;
            lightR = rr;
            lightG = gg;
            lightB = bb;
          }

          if (brightness < minBrightness) {
            minBrightness = brightness;
            darkR = rr;
            darkG = gg;
            darkB = bb;
          }
        }

        const dominant =
          n > 0
            ? `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`
            : "rgb(40, 40, 40)";
        const vibrant = maxSaturation > 0 ? `rgb(${vibrantR}, ${vibrantG}, ${vibrantB})` : dominant;
        const dark = `rgb(${darkR}, ${darkG}, ${darkB})`;
        const light = `rgb(${lightR}, ${lightG}, ${lightB})`;

        resolve({ dominant, vibrant, dark, light });
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => resolve(null);
    img.src = url;
  });

  paletteCache.set(url, task);
  return task;
}

export function buildPaletteBackgroundStyle(palette: CoverPalette | null): React.CSSProperties {
  if (!palette) {
    return {
      background: "linear-gradient(135deg, rgba(20, 20, 30, 1) 0%, rgba(10, 10, 15, 1) 100%)",
    } as React.CSSProperties;
  }

  const vibrantRGB = parseRgb(palette.vibrant);
  const dominantRGB = parseRgb(palette.dominant);
  const darkRGB = parseRgb(palette.dark);

  const vA = clamp01(0.22);
  const dA = clamp01(0.25);
  const dkA = clamp01(0.32);

  return {
    background: `
      radial-gradient(circle at 20% 30%, rgba(${vibrantRGB.r}, ${vibrantRGB.g}, ${vibrantRGB.b}, ${vA}) 0%, transparent 50%),
      radial-gradient(circle at 80% 20%, rgba(${dominantRGB.r}, ${dominantRGB.g}, ${dominantRGB.b}, ${dA}) 0%, transparent 60%),
      radial-gradient(circle at 50% 80%, rgba(${darkRGB.r}, ${darkRGB.g}, ${darkRGB.b}, ${dkA}) 0%, transparent 70%),
      linear-gradient(135deg, rgba(${darkRGB.r}, ${darkRGB.g}, ${darkRGB.b}, 0.95) 0%, rgba(5, 5, 10, 0.98) 100%)
    `,
  } as React.CSSProperties;
}

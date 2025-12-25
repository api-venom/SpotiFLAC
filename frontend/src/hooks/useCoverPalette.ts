import { useEffect, useState } from "react";
import { getPaletteFromImage, type CoverPalette } from "@/lib/cover/palette";

export function useCoverPalette(coverUrl?: string) {
  const [palette, setPalette] = useState<CoverPalette | null>(null);

  useEffect(() => {
    let alive = true;
    getPaletteFromImage(coverUrl).then((p) => {
      if (!alive) return;
      setPalette(p);
    });
    return () => {
      alive = false;
    };
  }, [coverUrl]);

  return palette;
}

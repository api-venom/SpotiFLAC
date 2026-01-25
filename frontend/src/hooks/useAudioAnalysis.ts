import { useCallback, useEffect, useMemo, useState } from "react";
import { analyzeTrack } from "@/lib/api";
import type { AnalysisResult, SpectrumData } from "@/types/api";
import { setSpectrumCache, getSpectrumCache, clearSpectrumCache } from "@/lib/spectrum-cache";

const STORAGE_KEY = "spotiflac_audio_analysis_state";

type AnalysisState = {
  filePath: string;
  result: AnalysisResult | null;
};

export function useAudioAnalysis() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string>("");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);

  // Load persisted state
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<AnalysisState>;
      if (parsed.filePath) setFilePath(parsed.filePath);
      if (parsed.result) setAnalysis(parsed.result as AnalysisResult);
    } catch {
      // ignore storage failures
    }
  }, []);

  // Persist state
  useEffect(() => {
    try {
      const toSave: AnalysisState = { filePath, result: analysis };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch {
      // ignore
    }
  }, [filePath, analysis]);

  const spectrum: SpectrumData | undefined = useMemo(() => {
    if (!analysis) return undefined;
    const cached = getSpectrumCache(filePath);
    if (cached) return cached;
    const data = analysis.spectrum;
    if (data) setSpectrumCache(filePath, data);
    return data;
  }, [analysis, filePath]);

  const runAnalysis = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    setFilePath(path);

    try {
      clearSpectrumCache(path);
      const result = await analyzeTrack(path);
      setAnalysis(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setAnalysis(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    if (filePath) clearSpectrumCache(filePath);
    setFilePath("");
    setAnalysis(null);
    setError(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, [filePath]);

  return {
    loading,
    error,
    filePath,
    analysis,
    spectrum,
    runAnalysis,
    clear,
  };
}

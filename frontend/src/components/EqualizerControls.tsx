import { useState } from "react";
import { Settings2, Music2, Zap, Radio, Mic2, Waves, Sliders, RotateCcw } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { player } from "@/lib/player";
import { toastWithSound } from "@/lib/toast-with-sound";

// EQ Presets (frequency in Hz -> gain in dB)
const EQ_PRESETS = {
  Flat: {
    name: "Flat",
    icon: Settings2,
    bands: {},
    preamp: 0,
    description: "No equalization",
  },
  Rock: {
    name: "Rock",
    icon: Zap,
    bands: {
      "60": 5,
      "170": 4,
      "310": -3,
      "600": -2,
      "1000": 1,
      "3000": 3,
      "6000": 4,
      "12000": 5,
      "14000": 5,
      "16000": 5,
    },
    preamp: -2,
    description: "Enhanced bass and treble",
  },
  Pop: {
    name: "Pop",
    icon: Music2,
    bands: {
      "60": -1,
      "170": 2,
      "310": 4,
      "600": 4,
      "1000": 3,
      "3000": 0,
      "6000": -1,
      "12000": -1,
      "14000": -1,
      "16000": -2,
    },
    preamp: -1,
    description: "Clear vocals and mid-range",
  },
  Jazz: {
    name: "Jazz",
    icon: Radio,
    bands: {
      "60": 3,
      "170": 2,
      "310": 1,
      "600": 1,
      "1000": -1,
      "3000": -1,
      "6000": 0,
      "12000": 2,
      "14000": 3,
      "16000": 3,
    },
    preamp: -1,
    description: "Warm and balanced",
  },
  Classical: {
    name: "Classical",
    icon: Mic2,
    bands: {
      "60": 3,
      "170": 2,
      "310": 0,
      "600": 0,
      "1000": 0,
      "3000": 0,
      "6000": -1,
      "12000": -1,
      "14000": 2,
      "16000": 3,
    },
    preamp: 0,
    description: "Natural orchestral sound",
  },
  Electronic: {
    name: "Electronic",
    icon: Waves,
    bands: {
      "60": 6,
      "170": 5,
      "310": 1,
      "600": 0,
      "1000": -2,
      "3000": 2,
      "6000": 1,
      "12000": 3,
      "14000": 4,
      "16000": 5,
    },
    preamp: -2,
    description: "Deep bass and crisp highs",
  },
  "Bass Boost": {
    name: "Bass Boost",
    icon: Waves,
    bands: {
      "60": 7,
      "170": 6,
      "310": 5,
      "600": 3,
      "1000": 0,
      "3000": 0,
      "6000": 0,
      "12000": 0,
      "14000": 0,
      "16000": 0,
    },
    preamp: -3,
    description: "Maximum low-end punch",
  },
  Vocal: {
    name: "Vocal",
    icon: Mic2,
    bands: {
      "60": -2,
      "170": -1,
      "310": 1,
      "600": 3,
      "1000": 4,
      "3000": 4,
      "6000": 3,
      "12000": 1,
      "14000": 0,
      "16000": -1,
    },
    preamp: 0,
    description: "Enhanced voice clarity",
  },
};

// 10-band EQ frequencies
const EQ_BANDS = [
  { freq: "32", label: "32 Hz" },
  { freq: "64", label: "64 Hz" },
  { freq: "125", label: "125 Hz" },
  { freq: "250", label: "250 Hz" },
  { freq: "500", label: "500 Hz" },
  { freq: "1000", label: "1 kHz" },
  { freq: "2000", label: "2 kHz" },
  { freq: "4000", label: "4 kHz" },
  { freq: "8000", label: "8 kHz" },
  { freq: "16000", label: "16 kHz" },
];

interface EqualizerControlsProps {
  className?: string;
  useMPV: boolean;
}

export function EqualizerControls({ className, useMPV }: EqualizerControlsProps) {
  const [activePreset, setActivePreset] = useState<string>("Flat");
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCustomMode, setIsCustomMode] = useState(false);
  
  // Custom EQ state
  const [customBands, setCustomBands] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    EQ_BANDS.forEach(band => initial[band.freq] = 0);
    return initial;
  });
  const [customPreamp, setCustomPreamp] = useState(0);

  const handlePresetChange = async (presetName: string) => {
    if (!useMPV) {
      toastWithSound.info("Equalizer is only available with MPV backend");
      return;
    }

    try {
      const preset = EQ_PRESETS[presetName as keyof typeof EQ_PRESETS];
      await player.setEqualizer(presetName, preset.bands, preset.preamp);
      setActivePreset(presetName);
      setIsCustomMode(false);
      toastWithSound.success(`Equalizer: ${presetName}`);
    } catch (err) {
      console.error("Failed to set equalizer:", err);
      toastWithSound.error("Failed to set equalizer");
    }
  };

  const handleCustomChange = async (freq: string, gain: number) => {
    if (!useMPV) return;
    
    const updatedBands = { ...customBands, [freq]: gain };
    setCustomBands(updatedBands);
    
    try {
      await player.setEqualizer("Custom", updatedBands, customPreamp);
      setActivePreset("Custom");
      setIsCustomMode(true);
    } catch (err) {
      console.error("Failed to set custom equalizer:", err);
    }
  };

  const handlePreampChange = async (preamp: number) => {
    if (!useMPV) return;
    
    setCustomPreamp(preamp);
    
    try {
      await player.setEqualizer("Custom", customBands, preamp);
      setActivePreset("Custom");
      setIsCustomMode(true);
    } catch (err) {
      console.error("Failed to set custom preamp:", err);
    }
  };

  const resetCustomEQ = () => {
    const resetBands: Record<string, number> = {};
    EQ_BANDS.forEach(band => resetBands[band.freq] = 0);
    setCustomBands(resetBands);
    setCustomPreamp(0);
    handlePresetChange("Flat");
  };

  if (!useMPV) {
    return (
      <div className={cn("text-center text-white/50 text-sm", className)}>
        <Settings2 className="h-5 w-5 mx-auto mb-1 opacity-50" />
        <div>Equalizer requires MPV backend</div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-white/70" />
          <span className="text-sm font-medium text-white/90">Audio Equalizer</span>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCustomMode(!isCustomMode)}
            className={cn(
              "text-xs h-7 px-2",
              isCustomMode 
                ? "bg-white/20 text-white hover:bg-white/25" 
                : "text-white/60 hover:text-white/90 hover:bg-white/10"
            )}
          >
            <Sliders className="h-3 w-3 mr-1" />
            Custom
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-white/60 hover:text-white/90 hover:bg-white/10 h-7 px-2"
          >
            {isExpanded ? "Show Less" : "Show All"}
          </Button>
        </div>
      </div>

      {/* Custom EQ Mode */}
      {isCustomMode ? (
        <div className="space-y-4">
          {/* Preamp Control */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-white/80">
              <span>Preamp</span>
              <span className="font-mono">{customPreamp.toFixed(1)} dB</span>
            </div>
            <input
              type="range"
              min="-12"
              max="12"
              step="0.5"
              value={customPreamp}
              onChange={(e) => handlePreampChange(parseFloat(e.target.value))}
              className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer 
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white 
                [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-lg"
            />
          </div>

          {/* Band Controls */}
          <div className="grid grid-cols-5 gap-3">
            {EQ_BANDS.map((band) => {
              const gain = customBands[band.freq] || 0;
              const percent = ((gain + 12) / 24) * 100; // Map -12 to 12 dB to 0-100%
              
              return (
                <div key={band.freq} className="flex flex-col items-center gap-2">
                  <div className="relative h-32 w-8 bg-white/10 rounded-full overflow-hidden">
                    {/* Filled portion */}
                    <div 
                      className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-blue-500 to-cyan-400 transition-all duration-150"
                      style={{ height: `${percent}%` }}
                    />
                    {/* Center mark at 0dB */}
                    <div className="absolute left-0 right-0 h-0.5 bg-white/30" style={{ top: '50%' }} />
                  </div>
                  
                  <input
                    type="range"
                    min="-12"
                    max="12"
                    step="0.5"
                    value={gain}
                    onChange={(e) => handleCustomChange(band.freq, parseFloat(e.target.value))}
                    orient="vertical"
                    className="sr-only"
                  />
                  
                  <button
                    onClick={() => {
                      const newGain = gain + 1 > 12 ? -12 : gain + 1;
                      handleCustomChange(band.freq, newGain);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      const newGain = gain - 1 < -12 ? 12 : gain - 1;
                      handleCustomChange(band.freq, newGain);
                    }}
                    className="text-xs text-white/60 hover:text-white/90 font-medium"
                  >
                    {band.label}
                  </button>
                  
                  <div className="text-xs text-white/50 font-mono">
                    {gain > 0 ? '+' : ''}{gain.toFixed(1)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Reset Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={resetCustomEQ}
            className="w-full text-xs text-white/60 hover:text-white/90 hover:bg-white/10 h-8"
          >
            <RotateCcw className="h-3 w-3 mr-2" />
            Reset to Flat
          </Button>
        </div>
      ) : (
        <>
          {/* Preset Buttons */}
          <div className="grid grid-cols-4 gap-2">
            {Object.entries(EQ_PRESETS)
              .slice(0, isExpanded ? undefined : 4)
              .map(([key, preset]) => {
                const Icon = preset.icon;
                const isActive = activePreset === key;
                return (
                  <Button
                    key={key}
                    variant="ghost"
                    onClick={() => handlePresetChange(key)}
                    className={cn(
                      "flex flex-col items-center justify-center h-20 p-2 transition-all duration-200",
                      isActive
                        ? "bg-white/20 text-white border-2 border-white/40 shadow-lg"
                        : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white border border-white/10"
                    )}
                  >
                    <Icon className={cn("h-5 w-5 mb-1", isActive && "scale-110")} />
                    <span className="text-xs font-medium">{preset.name}</span>
                  </Button>
                );
              })}
          </div>

          {/* Current Preset Info */}
          {activePreset !== "Flat" && (
            <div className="text-xs text-white/60 text-center py-2 px-3 bg-white/5 rounded-lg border border-white/10">
              {EQ_PRESETS[activePreset as keyof typeof EQ_PRESETS].description}
            </div>
          )}
        </>
      )}
    </div>
  );
}

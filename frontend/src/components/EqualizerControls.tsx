import { useState } from "react";
import { Settings2, Music2, Zap, Radio, Mic2, Waves } from "lucide-react";
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

interface EqualizerControlsProps {
  className?: string;
  useMPV: boolean;
}

export function EqualizerControls({ className, useMPV }: EqualizerControlsProps) {
  const [activePreset, setActivePreset] = useState<string>("Flat");
  const [isExpanded, setIsExpanded] = useState(false);

  const handlePresetChange = async (presetName: string) => {
    if (!useMPV) {
      toastWithSound.info("Equalizer is only available with MPV backend");
      return;
    }

    try {
      const preset = EQ_PRESETS[presetName as keyof typeof EQ_PRESETS];
      await player.setEqualizer(presetName, preset.bands, preset.preamp);
      setActivePreset(presetName);
      toastWithSound.success(`Equalizer: ${presetName}`);
    } catch (err) {
      console.error("Failed to set equalizer:", err);
      toastWithSound.error("Failed to set equalizer");
    }
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
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs text-white/60 hover:text-white/90 hover:bg-white/10 h-7 px-2"
        >
          {isExpanded ? "Show Less" : "Show All"}
        </Button>
      </div>

      {/* Quick Presets (always visible) */}
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
    </div>
  );
}

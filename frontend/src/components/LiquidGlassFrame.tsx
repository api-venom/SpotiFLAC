import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type AnyComponent = React.ComponentType<any>;

type LiquidGlassFrameProps = {
  children: React.ReactNode;
  className?: string;
};

export function LiquidGlassFrame({ children, className }: LiquidGlassFrameProps) {
  const [GlassComponent, setGlassComponent] = useState<AnyComponent | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Best-effort: if @liquidglass/react is installed, use it.
    // Otherwise fall back to a lightweight glassy container.
    import("@liquidglass/react")
      .then((m: any) => {
        if (cancelled) return;
        const Candidate = (m?.LiquidGlass || m?.Glass || m?.default) as AnyComponent | undefined;
        if (Candidate) setGlassComponent(() => Candidate);
      })
      .catch(() => {
        // Keep fallback
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (GlassComponent) {
    const Comp = GlassComponent;
    return (
      <Comp className={cn("rounded-xl border border-border/50", className)}>
        {children}
      </Comp>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-border/50 bg-background/60 backdrop-blur-md p-4 md:p-6",
        className
      )}
    >
      {children}
    </div>
  );
}

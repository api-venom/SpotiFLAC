import { useState } from "react";

export function useNowPlayingQueue() {
  const [isOpen, setIsOpen] = useState(false);

  return {
    isOpen,
    openQueue: () => setIsOpen(true),
    closeQueue: () => setIsOpen(false),
    toggleQueue: () => setIsOpen((prev) => !prev),
  };
}

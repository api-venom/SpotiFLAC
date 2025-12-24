import { useEffect, useState } from "react";
import { player } from "../lib/player";

export function usePlayer() {
  const [state, setState] = useState(player.getState());

  useEffect(() => {
    const unsubscribe = player.subscribe(setState);
    return () => {
      unsubscribe();
    };
  }, []);

  return {
    state,
    player,
  };
}

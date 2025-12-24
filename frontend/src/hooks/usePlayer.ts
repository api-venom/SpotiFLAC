import { useEffect, useState } from "react";
import { player } from "../lib/player";

export function usePlayer() {
  const [state, setState] = useState(player.getState());

  useEffect(() => player.subscribe(setState), []);

  return {
    state,
    player,
  };
}

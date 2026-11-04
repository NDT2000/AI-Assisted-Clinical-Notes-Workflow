import {
  createContext,
  useContext,
} from "react";

import type {
  Actor,
} from "../domain/actor";
import {
  CURRENT_ACTOR,
} from "./currentActor";

export interface CurrentActorContextValue {
  actor: Actor;
  setActorById: (
    actorId: string,
  ) => void;
}

export const CurrentActorContext =
  createContext<
    CurrentActorContextValue | null
  >(null);

// Used outside a provider, e.g. in isolated component tests.
const FALLBACK_CONTEXT:
  CurrentActorContextValue = {
    actor: CURRENT_ACTOR,
    setActorById() {},
  };

/* The demo identity the app is currently acting as. */
export function useCurrentActor():
  CurrentActorContextValue {
  return (
    useContext(CurrentActorContext) ??
    FALLBACK_CONTEXT
  );
}

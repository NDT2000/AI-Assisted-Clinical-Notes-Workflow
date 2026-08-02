import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type {
  TransitionNoteActor,
} from "../domain/noteTransition";
import {
  CURRENT_ACTOR,
  getDemoActorById,
} from "./currentActor";

const SESSION_STORAGE_KEY =
  "clinical-notes-demo-actor-id";

interface CurrentActorContextValue {
  actor: TransitionNoteActor;
  setActorById: (
    actorId: string,
  ) => void;
}

const CurrentActorContext =
  createContext<
    CurrentActorContextValue | null
  >(null);

const FALLBACK_CONTEXT:
  CurrentActorContextValue = {
    actor: CURRENT_ACTOR,
    setActorById() {},
  };

function getInitialActor():
  TransitionNoteActor {
  if (
    typeof sessionStorage ===
    "undefined"
  ) {
    return CURRENT_ACTOR;
  }

  const storedActorId =
    sessionStorage.getItem(
      SESSION_STORAGE_KEY,
    );

  if (storedActorId === null) {
    return CURRENT_ACTOR;
  }

  return (
    getDemoActorById(
      storedActorId,
    ) ?? CURRENT_ACTOR
  );
}

export function CurrentActorProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [actor, setActor] =
    useState<TransitionNoteActor>(
      getInitialActor,
    );

  const value = useMemo(
    () => ({
      actor,
      setActorById(
        actorId: string,
      ) {
        const nextActor =
          getDemoActorById(
            actorId,
          );

        if (nextActor === null) {
          return;
        }

        setActor(nextActor);

        if (
          typeof sessionStorage !==
          "undefined"
        ) {
          sessionStorage.setItem(
            SESSION_STORAGE_KEY,
            nextActor.id,
          );
        }
      },
    }),
    [actor],
  );

  return (
    <CurrentActorContext.Provider
      value={value}
    >
      {children}
    </CurrentActorContext.Provider>
  );
}

export function useCurrentActor():
  CurrentActorContextValue {
  const context =
    useContext(
      CurrentActorContext,
    );

  return (
    context ??
    FALLBACK_CONTEXT
  );
}

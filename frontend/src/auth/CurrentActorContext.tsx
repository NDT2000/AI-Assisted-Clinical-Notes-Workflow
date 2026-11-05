import {
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type {
  Actor,
} from "../domain/actor";
import {
  CURRENT_ACTOR,
  getDemoActorById,
} from "./currentActor";
import {
  CurrentActorContext,
} from "./useCurrentActor";
import {
  setActiveActor,
} from "./activeActor";

const SESSION_STORAGE_KEY =
  "clinical-notes-demo-actor-id";

function getStoredActor():
  Actor {
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

// API requests that do not name an actor are sent as this one.
function getInitialActor():
  Actor {
  const actor = getStoredActor();

  setActiveActor(actor);

  return actor;
}

export function CurrentActorProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [actor, setActor] =
    useState<Actor>(
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

        setActiveActor(nextActor);
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

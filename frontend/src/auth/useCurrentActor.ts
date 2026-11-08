import { useSyncExternalStore } from "react";

import {
  session,
  type SessionState,
  type SessionUser,
} from "./session";

export function useSession(): SessionState {
  return useSyncExternalStore(
    session.subscribe,
    session.getState,
    session.getState,
  );
}

/*
 * The signed-in user. Only used inside pages that require signing in
 * (RequireSignIn), so there always is one.
 */
export function useCurrentActor(): { actor: SessionUser } {
  const state = useSession();

  if (state.status !== "signedIn") {
    throw new Error("useCurrentActor needs a signed-in user.");
  }

  return { actor: state.user };
}

import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import type { SignInLocationState } from "./SignInPage";
import { useSession } from "./useCurrentActor";

/*
 * Shows its children only to a signed-in user. Anyone else goes to the
 * sign-in page, and comes back to the page they asked for afterwards.
 */
export function RequireSignIn({ children }: { children: ReactNode }) {
  const state = useSession();
  const location = useLocation();

  if (state.status === "starting") {
    return (
      <main className="auth-page">
        <p role="status">Loading…</p>
      </main>
    );
  }

  if (state.status === "signedOut") {
    const signInState: SignInLocationState = {
      from: `${location.pathname}${location.search}`,
    };
    return <Navigate to="/sign-in" replace state={signInState} />;
  }

  return children;
}

import { apiUrl } from "../api/apiConfig";

/*
 * The setup-link calls behind the set-password page. They need no sign-in:
 * the link itself is the proof.
 */

export interface SetupLinkInfo {
  username: string;
  displayName: string;
  expiresAt: string;
}

export type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

const UNREACHABLE =
  "The server could not be reached. Check your connection.";

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(apiUrl(path), {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function failure(response: Response): Promise<{
  ok: false;
  message: string;
}> {
  try {
    const body = (await response.json()) as { message?: string };
    return {
      ok: false,
      message: body.message?.trim() || "Something went wrong. Try again.",
    };
  } catch {
    return { ok: false, message: "Something went wrong. Try again." };
  }
}

export async function checkSetupLink(
  token: string,
): Promise<Outcome<SetupLinkInfo>> {
  try {
    const response = await post("/api/auth/setup-link", { token });
    return response.ok
      ? { ok: true, value: (await response.json()) as SetupLinkInfo }
      : await failure(response);
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
}

export async function setPassword(
  token: string,
  password: string,
): Promise<Outcome<null>> {
  try {
    const response = await post("/api/auth/set-password", {
      token,
      password,
    });
    return response.ok ? { ok: true, value: null } : await failure(response);
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
}

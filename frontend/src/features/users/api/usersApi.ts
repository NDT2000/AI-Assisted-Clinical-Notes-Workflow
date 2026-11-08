import { apiFetch } from "../../../api/apiClient";
import type { components } from "../../../generated/api-schema";
import type { UserRole } from "../../../domain/noteAttributes";

/*
 * The administrator's account endpoints (/api/users). Types come from the
 * API description (contract/openapi.json), so they cannot drift from it.
 */

type Schemas = components["schemas"];

export type UserAccount = Schemas["UserAccount"];
export type UserDetail = Schemas["UserDetailResponse"];
export type AdminEvent = Schemas["AdminEvent"];
export type SetupLink = Schemas["SetupLink"];
export type AccountStatus = UserAccount["status"];

/* The API refused: its error code, message and any extra fields. */
export class UsersApiError extends Error {
  readonly status: number;

  readonly code: string;

  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "UsersApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, {
    ...init,
    headers:
      init.body === undefined
        ? init.headers
        : { "content-type": "application/json", ...init.headers },
  });

  if (!response.ok) {
    let body: Record<string, unknown> = {};

    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      // Not JSON: fall back to a general message below.
    }

    const { error, message, ...details } = body;

    throw new UsersApiError(
      response.status,
      typeof error === "string" ? error : "request_failed",
      typeof message === "string" && message.trim() !== ""
        ? message
        : "The request failed. Try again.",
      details,
    );
  }

  return (await response.json()) as T;
}

export interface UserListFilters {
  q: string;
  role: UserRole | "";
  active: "true" | "false" | "";
}

export function listUsers(
  filters: UserListFilters,
  signal?: AbortSignal,
): Promise<{ users: UserAccount[] }> {
  const params = new URLSearchParams();

  if (filters.q.trim() !== "") {
    params.set("q", filters.q.trim());
  }

  if (filters.role !== "") {
    params.set("role", filters.role);
  }

  if (filters.active !== "") {
    params.set("active", filters.active);
  }

  const query = params.toString();

  return request(`/api/users${query === "" ? "" : `?${query}`}`, { signal });
}

export function getUser(
  userId: string,
  signal?: AbortSignal,
): Promise<UserDetail> {
  return request(`/api/users/${encodeURIComponent(userId)}`, { signal });
}

export function createUser(body: {
  username: string;
  displayName: string;
  role: UserRole;
}): Promise<{ user: UserAccount; setupLink: SetupLink }> {
  return request("/api/users", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateUser(
  userId: string,
  changes: { username?: string; displayName?: string; role?: UserRole },
): Promise<UserDetail> {
  return request(`/api/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

export function deactivateUser(
  userId: string,
  confirmOpenReviews = false,
): Promise<UserDetail> {
  return request(`/api/users/${encodeURIComponent(userId)}/deactivate`, {
    method: "POST",
    body: JSON.stringify({ confirmOpenReviews }),
  });
}

export function reactivateUser(userId: string): Promise<UserDetail> {
  return request(`/api/users/${encodeURIComponent(userId)}/reactivate`, {
    method: "POST",
  });
}

export function issueSetupLink(userId: string): Promise<SetupLink> {
  return request(`/api/users/${encodeURIComponent(userId)}/setup-link`, {
    method: "POST",
  });
}

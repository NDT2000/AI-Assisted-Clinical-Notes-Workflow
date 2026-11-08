import { useSyncExternalStore } from "react";

import { apiFetch } from "../../api/apiClient";
import { session } from "../../auth/session";
import type { Reviewer } from "../../domain/reviewers";

/*
 * The active reviewers, from GET /api/users/directory?role=REVIEWER.
 * Loaded once per sign-in and shared by every reviewer picker, so newly
 * added reviewers appear and deactivated ones disappear. Until it loads
 * (or if it cannot), the list is empty.
 */

interface DirectoryResponse {
  users: { id: string; displayName: string; role: string }[];
}

export class ReviewerDirectory {
  private reviewers: readonly Reviewer[] = [];

  private loading: Promise<void> | null = null;

  private readonly listeners = new Set<() => void>();

  private readonly fetchDirectory: () => Promise<Response>;

  constructor(fetchDirectory: () => Promise<Response>) {
    this.fetchDirectory = fetchDirectory;
  }

  getSnapshot = (): readonly Reviewer[] => this.reviewers;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    void this.load();
    return () => {
      this.listeners.delete(listener);
    };
  };

  load(): Promise<void> {
    this.loading ??= this.fetchDirectory()
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`The reviewer list failed (${response.status}).`);
        }

        const body = (await response.json()) as DirectoryResponse;
        this.set(
          body.users.map((user) => ({
            id: user.id,
            displayName: user.displayName,
          })),
        );
      })
      .catch(() => {
        // Try again the next time a picker appears.
        this.loading = null;
      });

    return this.loading;
  }

  /* Forget the list, as when the user signs out. */
  clear(): void {
    this.loading = null;
    this.set([]);
  }

  private set(reviewers: readonly Reviewer[]): void {
    this.reviewers = reviewers;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const reviewerDirectory = new ReviewerDirectory(() =>
  apiFetch("/api/users/directory?role=REVIEWER"),
);

session.onSignedOut(() => reviewerDirectory.clear());

export function useReviewers(
  directory: ReviewerDirectory = reviewerDirectory,
): readonly Reviewer[] {
  return useSyncExternalStore(
    directory.subscribe,
    directory.getSnapshot,
    directory.getSnapshot,
  );
}

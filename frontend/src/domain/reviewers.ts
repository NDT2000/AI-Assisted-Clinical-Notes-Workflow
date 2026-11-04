/*
 * The reviewer directory. Static for now; with a real backend this
 * becomes a lookup endpoint rather than a bundled constant.
 */
export const REVIEWERS = [
  {
    id: "reviewer-1",
    displayName: "Alex Kim",
  },
  {
    id: "reviewer-2",
    displayName: "Sam Rivera",
  },
  {
    id: "reviewer-3",
    displayName: "Drew Patel",
  },
  {
    id: "reviewer-4",
    displayName: "Robin Chen",
  },
  {
    id: "reviewer-5",
    displayName: "Jules Martin",
  },
] as const;

export type Reviewer =
  (typeof REVIEWERS)[number];

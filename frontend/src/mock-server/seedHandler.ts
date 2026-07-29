import { http, HttpResponse } from "msw";

import { seedNotes } from "./noteStore";
import { simulateNetwork } from "./mockNetwork";

interface SeedRequestBody {
  count?: number;
  seed?: number;
}

const DEFAULT_SEED_VALUE = 42;
const MAX_SEED_COUNT = 100_000;

export const seedHandler = http.post(
  "*/api/dev/seed",
  async ({ request }) => {
    // Seeding itself should never be flaky — it's test setup, not the
    // thing under test — so failureRate is forced to 0 here.
    await simulateNetwork({ failureRate: 0 });

    const body = (await request.json()) as SeedRequestBody;

    const requestedCount = body.count ?? 5_000;

    const count = Math.max(
      0,
      Math.min(requestedCount, MAX_SEED_COUNT),
    );

    const seed = body.seed ?? DEFAULT_SEED_VALUE;

    const seededCount = seedNotes(count, seed);

    return HttpResponse.json({
      seeded: seededCount,
      seed,
    });
  },
);
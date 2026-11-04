// Exports a sample of the frontend's mock data so the Python seed
// generator can be checked against it. Regenerate after changing either
// generator, from the repository root:
//
//   npx --prefix frontend vite-node backend/tests/fixtures/export_mock_sample.ts
//
// The output is written next to this file as mock_data_sample.json.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateNoteDetail } from "../../../frontend/src/mock-data/generateNoteDetail";
import { generateNoteSummaries } from "../../../frontend/src/mock-data/generateNoteSummary";

const COUNT = 60;
const SEED = 42;

const summaries = generateNoteSummaries(COUNT, SEED);

const sample = {
  count: COUNT,
  seed: SEED,
  summaries,
  details: summaries.map(summary => {
    const detail = generateNoteDetail(summary);
    // Presence is live state, not stored data.
    const { presence: _presence, ...stored } = detail;
    return stored;
  }),
};

const output = join(
  dirname(fileURLToPath(import.meta.url)),
  "mock_data_sample.json",
);

writeFileSync(output, `${JSON.stringify(sample, null, 2)}\n`);
console.log(`Wrote ${COUNT} notes to ${output}`);

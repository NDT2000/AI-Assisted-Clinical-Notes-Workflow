const MIN_LATENCY_MS = 100;
const MAX_LATENCY_MS = 800;
const FAILURE_RATE = 0.05;

export class SimulatedNetworkFailure extends Error {
  constructor() {
    super("Simulated network failure");
    this.name = "SimulatedNetworkFailure";
  }
}

function randomLatency(): number {
  return (
    MIN_LATENCY_MS +
    Math.random() * (MAX_LATENCY_MS - MIN_LATENCY_MS)
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function simulateNetwork(
  options?: { failureRate?: number },
): Promise<void> {
  await wait(randomLatency());

  const failureRate = options?.failureRate ?? FAILURE_RATE;

  if (Math.random() < failureRate) {
    throw new SimulatedNetworkFailure();
  }
}
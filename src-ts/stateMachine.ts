export enum Phase {
  IDEATION = "IDEATION",
  ARCHITECTURE = "ARCHITECTURE",
  TASK_GRAPH = "TASK_GRAPH",
  CODING = "CODING",
  INTEGRATION = "INTEGRATION",
  TESTING = "TESTING",
  VERIFICATION = "VERIFICATION",
  DEPLOY = "DEPLOY",
  DONE = "DONE",
  FAILED = "FAILED",
}

const TRANSITIONS: Record<Phase, Phase[]> = {
  [Phase.IDEATION]: [Phase.ARCHITECTURE],
  [Phase.ARCHITECTURE]: [Phase.TASK_GRAPH],
  [Phase.TASK_GRAPH]: [Phase.CODING],
  [Phase.CODING]: [Phase.INTEGRATION],
  [Phase.INTEGRATION]: [Phase.TESTING],
  [Phase.TESTING]: [Phase.VERIFICATION],
  [Phase.VERIFICATION]: [Phase.DONE, Phase.CODING, Phase.DEPLOY],
  [Phase.DEPLOY]: [Phase.DONE],
  [Phase.DONE]: [],
  [Phase.FAILED]: [],
};

export class InvalidTransitionError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "InvalidTransitionError";
  }
}

export function transition(current: Phase, next: Phase): Phase {
  const allowed = TRANSITIONS[current] ?? [];
  if (!allowed.includes(next)) {
    throw new InvalidTransitionError(
      `Cannot go from ${current} to ${next}. Allowed: ${allowed.join(", ")}`
    );
  }
  return next;
}

from enum import Enum


class Phase(str, Enum):
    IDEATION = "IDEATION"
    ARCHITECTURE = "ARCHITECTURE"
    TASK_GRAPH = "TASK_GRAPH"
    CODING = "CODING"
    INTEGRATION = "INTEGRATION"
    TESTING = "TESTING"
    VERIFICATION = "VERIFICATION"
    DEPLOY = "DEPLOY"
    DONE = "DONE"
    FAILED = "FAILED"


TRANSITIONS: dict[Phase, list[Phase]] = {
    Phase.IDEATION: [Phase.ARCHITECTURE],
    Phase.ARCHITECTURE: [Phase.TASK_GRAPH],
    Phase.TASK_GRAPH: [Phase.CODING],
    Phase.CODING: [Phase.INTEGRATION],
    Phase.INTEGRATION: [Phase.TESTING],
    Phase.TESTING: [Phase.VERIFICATION],
    Phase.VERIFICATION: [Phase.DONE, Phase.CODING, Phase.DEPLOY],
    Phase.DEPLOY: [Phase.DONE],
    Phase.DONE: [],
    Phase.FAILED: [],
}


class InvalidTransitionError(Exception):
    pass


def transition(current: Phase, next_phase: Phase) -> Phase:
    allowed = TRANSITIONS.get(current, [])
    if next_phase not in allowed:
        raise InvalidTransitionError(
            f"Cannot go from {current} to {next_phase}. Allowed: {[p.value for p in allowed]}"
        )
    return next_phase

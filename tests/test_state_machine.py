import pytest
from forge.state_machine import Phase, transition, InvalidTransitionError


def test_valid_transitions() -> None:
    assert transition(Phase.IDEATION, Phase.ARCHITECTURE) == Phase.ARCHITECTURE
    assert transition(Phase.ARCHITECTURE, Phase.TASK_GRAPH) == Phase.TASK_GRAPH
    assert transition(Phase.TASK_GRAPH, Phase.CODING) == Phase.CODING
    assert transition(Phase.CODING, Phase.INTEGRATION) == Phase.INTEGRATION
    assert transition(Phase.INTEGRATION, Phase.TESTING) == Phase.TESTING
    assert transition(Phase.TESTING, Phase.VERIFICATION) == Phase.VERIFICATION
    assert transition(Phase.VERIFICATION, Phase.DONE) == Phase.DONE
    assert transition(Phase.VERIFICATION, Phase.CODING) == Phase.CODING
    assert transition(Phase.VERIFICATION, Phase.DEPLOY) == Phase.DEPLOY
    assert transition(Phase.DEPLOY, Phase.DONE) == Phase.DONE


def test_invalid_transition_raises() -> None:
    with pytest.raises(InvalidTransitionError):
        transition(Phase.IDEATION, Phase.CODING)


def test_cannot_leave_done() -> None:
    with pytest.raises(InvalidTransitionError):
        transition(Phase.DONE, Phase.IDEATION)


def test_phase_is_string_enum() -> None:
    assert Phase.IDEATION == "IDEATION"
    assert Phase("CODING") == Phase.CODING

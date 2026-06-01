import pytest
from forge.ui.live_feed import LiveFeed
from forge.state_machine import Phase


def test_live_feed_records_events() -> None:
    feed = LiveFeed(session_id="abc123", idea="build a todo app")
    feed.push_event(Phase.IDEATION, "Starting ideation")
    feed.push_event(Phase.ARCHITECTURE, "Architecture decided")
    assert len(feed.events) == 2
    assert feed.events[0]["message"] == "Starting ideation"


def test_live_feed_records_tasks() -> None:
    feed = LiveFeed(session_id="abc123", idea="build a todo app")
    feed.update_task("task1", "Setup project", "pending", None)
    feed.update_task("task1", "Setup project", "in_progress", "CodingAgent")
    assert feed.tasks["task1"]["status"] == "in_progress"
    assert feed.tasks["task1"]["agent"] == "CodingAgent"


def test_live_feed_sets_overseer_message() -> None:
    feed = LiveFeed(session_id="abc123", idea="build a todo app")
    feed.set_overseer("Dispatching 3 tasks")
    assert feed.overseer_message == "Dispatching 3 tasks"

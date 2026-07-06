"""Crowd engine: phase mapping, determinism, bounds, and alert derivation."""

import pytest

from app.services.crowd import TIMELINE_END, TIMELINE_START, CrowdService, phase_for
from app.services.navigation import get_stadium_map


@pytest.fixture(scope="module")
def crowd():
    return CrowdService(get_stadium_map())


@pytest.mark.parametrize(
    ("minute", "phase"),
    [
        (-90, "ingress"),
        (-16, "ingress"),
        (-1, "pre_match"),
        (0, "first_half"),
        (44, "first_half"),
        (50, "halftime"),
        (75, "second_half"),
        (120, "egress"),
    ],
)
def test_phase_mapping(minute, phase):
    assert phase_for(minute) == phase


def test_snapshot_is_deterministic(crowd):
    assert crowd.snapshot(30) == crowd.snapshot(30)


def test_densities_bounded_and_statuses_valid(crowd):
    for minute in range(TIMELINE_START, TIMELINE_END + 1, 15):
        snap = crowd.snapshot(minute)
        for zone in snap.zones:
            assert 0.0 < zone.density <= 1.0
            assert zone.status in {"low", "moderate", "high", "critical"}
            assert zone.occupancy <= zone.capacity


def test_minute_is_clamped_to_timeline(crowd):
    assert crowd.snapshot(-500).match_minute == TIMELINE_START
    assert crowd.snapshot(500).match_minute == TIMELINE_END


def test_halftime_is_busier_than_first_half(crowd):
    playing = crowd.snapshot(30)
    halftime = crowd.snapshot(52)
    avg = lambda snap: sum(z.density for z in snap.zones) / len(snap.zones)  # noqa: E731
    assert avg(halftime) > avg(playing)


def test_alerts_reference_real_zones_and_carry_actions(crowd):
    snap = crowd.snapshot(52)  # halftime — congestion expected
    stadium = get_stadium_map()
    known = set(stadium.zones) | set(stadium.nodes)
    assert snap.alerts, "halftime should produce at least one alert"
    for alert in snap.alerts:
        assert alert.zone_id in known
        assert alert.severity in {"warning", "critical"}
        assert alert.recommendation

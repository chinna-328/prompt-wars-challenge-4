"""Wayfinding: shortest paths, the step-free constraint, and error handling."""

import pytest

from app.services.navigation import (
    NoRouteError,
    UnknownLocationError,
    get_stadium_map,
)


@pytest.fixture(scope="module")
def stadium():
    return get_stadium_map()


def test_shortest_route_is_connected_and_summed(stadium):
    route = stadium.find_route("gate_e1", "sec_201")
    assert route.steps[0].node_id == "gate_e1"
    assert route.steps[-1].node_id == "sec_201"
    assert route.total_meters == sum(s.meters_from_previous for s in route.steps)
    assert route.est_minutes >= 1


def test_default_route_may_use_stairs(stadium):
    route = stadium.find_route("gate_e1", "sec_201", accessible=False)
    # Stairs (35 m) beat the elevator (30+50 m) on pure distance.
    assert "stairs_e" in [s.node_id for s in route.steps]


def test_accessible_route_avoids_stairs(stadium):
    route = stadium.find_route("gate_e1", "sec_201", accessible=True)
    node_ids = [s.node_id for s in route.steps]
    assert "stairs_e" not in node_ids
    assert "elevator_e" in node_ids
    assert route.accessible is True


def test_accessible_route_exists_for_every_seating_section(stadium):
    """Accessibility guarantee: every seat is reachable step-free from every gate."""
    gates = [n for n, d in stadium.nodes.items() if d["kind"] == "gate"]
    seats = [n for n, d in stadium.nodes.items() if d["kind"] == "seating"]
    for gate in gates:
        for seat in seats:
            route = stadium.find_route(gate, seat, accessible=True)
            assert route.total_meters > 0


def test_unknown_location_raises(stadium):
    with pytest.raises(UnknownLocationError):
        stadium.find_route("gate_e1", "vip_moon_lounge")


def test_same_origin_destination_is_zero_length(stadium):
    route = stadium.find_route("plaza", "plaza")
    assert route.total_meters == 0
    assert len(route.steps) == 1


def test_no_route_error_when_constraint_unsatisfiable(stadium):
    # An isolated graph cannot happen with the shipped map, so simulate by
    # asking for a step-free route in a map slice where none exists.
    from app.services.navigation import StadiumMap

    tiny = StadiumMap(
        {
            "venue": "t",
            "zones": [{"id": "z", "name": "z", "capacity": 1}],
            "nodes": [
                {"id": "a", "name": "A", "kind": "gate", "zone": "z", "level": 1},
                {"id": "b", "name": "B", "kind": "seating", "zone": "z", "level": 2},
            ],
            "edges": [{"a": "a", "b": "b", "meters": 10, "step_free": False}],
        }
    )
    with pytest.raises(NoRouteError):
        tiny.find_route("a", "b", accessible=True)
    assert tiny.find_route("a", "b").total_meters == 10

"""Stadium wayfinding: weighted walkway graph with step-free routing.

The map ships as data (app/data/stadium.json) so venues can be swapped
without touching code. Routing is Dijkstra over edge distance; passing
`accessible=True` drops every edge that involves stairs, which is how
wheelchair users, families with strollers, and injured fans are served.
"""

import heapq
import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

_DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "stadium.json"

WALK_SPEED_M_PER_MIN = 70  # comfortable crowd-pace walking speed


class UnknownLocationError(ValueError):
    """A requested node id does not exist on the venue map."""


class NoRouteError(ValueError):
    """No path satisfies the constraints (e.g. no step-free option)."""


@dataclass(frozen=True, slots=True)
class RouteStep:
    """One waypoint on a route, with the leg distance from the previous step."""

    node_id: str
    name: str
    kind: str
    meters_from_previous: int


@dataclass(frozen=True, slots=True)
class Route:
    """A complete computed route: ordered steps plus distance/time totals."""

    steps: list[RouteStep]
    total_meters: int
    est_minutes: int
    accessible: bool


class StadiumMap:
    """Immutable view of the venue: nodes, zones, and the walkway graph."""

    def __init__(self, raw: dict) -> None:
        self.venue: str = raw["venue"]
        self.zones: dict[str, dict] = {z["id"]: z for z in raw["zones"]}
        self.nodes: dict[str, dict] = {n["id"]: n for n in raw["nodes"]}
        # adjacency: node -> list of (neighbor, meters, step_free)
        self._adjacency: dict[str, list[tuple[str, int, bool]]] = {n: [] for n in self.nodes}
        for edge in raw["edges"]:
            self._adjacency[edge["a"]].append((edge["b"], edge["meters"], edge["step_free"]))
            self._adjacency[edge["b"]].append((edge["a"], edge["meters"], edge["step_free"]))

    def find_route(self, origin: str, destination: str, accessible: bool = False) -> Route:
        """Shortest walkway path between two nodes (Dijkstra over meters).

        With `accessible=True`, edges involving stairs are excluded, so the
        result is verified step-free. Raises UnknownLocationError for ids not
        on the map and NoRouteError when no path satisfies the constraint.
        """
        for node_id in (origin, destination):
            if node_id not in self.nodes:
                raise UnknownLocationError(f"Unknown location: {node_id}")

        distances: dict[str, int] = {origin: 0}
        previous: dict[str, str] = {}
        queue: list[tuple[int, str]] = [(0, origin)]
        while queue:
            dist, node = heapq.heappop(queue)
            if node == destination:
                break
            if dist > distances.get(node, float("inf")):
                continue  # stale queue entry
            for neighbor, meters, step_free in self._adjacency[node]:
                if accessible and not step_free:
                    continue
                candidate = dist + meters
                if candidate < distances.get(neighbor, float("inf")):
                    distances[neighbor] = candidate
                    previous[neighbor] = node
                    heapq.heappush(queue, (candidate, neighbor))

        if destination not in distances and origin != destination:
            constraint = "step-free " if accessible else ""
            raise NoRouteError(f"No {constraint}route from {origin} to {destination}")

        # Walk back from destination to origin to recover the path.
        path = [destination]
        while path[-1] != origin:
            path.append(previous[path[-1]])
        path.reverse()

        steps: list[RouteStep] = []
        for index, node_id in enumerate(path):
            node_data = self.nodes[node_id]
            meters = 0
            if index > 0:
                prior = path[index - 1]
                meters = next(m for nbr, m, _ in self._adjacency[prior] if nbr == node_id)
            steps.append(
                RouteStep(
                    node_id=node_id,
                    name=node_data["name"],
                    kind=node_data["kind"],
                    meters_from_previous=meters,
                )
            )
        total = sum(s.meters_from_previous for s in steps)
        return Route(
            steps=steps,
            total_meters=total,
            est_minutes=max(1, round(total / WALK_SPEED_M_PER_MIN)),
            accessible=accessible,
        )


@lru_cache
def get_stadium_map() -> StadiumMap:
    """Load and cache the venue map once per process."""
    with _DATA_PATH.open(encoding="utf-8") as fh:
        return StadiumMap(json.load(fh))

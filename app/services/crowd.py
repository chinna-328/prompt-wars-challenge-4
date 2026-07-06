"""Crowd telemetry engine: live zone densities, gate queues, and alerts.

In production these numbers would arrive from turnstiles, CV cameras and
Wi-Fi probes. Here a deterministic simulator reproduces a realistic match
day (ingress surge → halftime spike → egress wave) as a pure function of
the match clock, so the whole platform is demoable and unit-testable
offline while keeping the exact interfaces a real feed would use.
"""

import math
from dataclasses import dataclass
from datetime import UTC, datetime

from app.services.navigation import StadiumMap

# Match clock, in minutes relative to kickoff.
TIMELINE_START = -90  # gates open
TIMELINE_END = 135    # egress complete
_TIMELINE_LEN = TIMELINE_END - TIMELINE_START

# Baseline zone fill fraction per match phase.
_PHASE_BASE = {
    "ingress": 0.45,
    "pre_match": 0.70,
    "first_half": 0.35,
    "halftime": 0.88,
    "second_half": 0.38,
    "egress": 0.80,
}

_STATUS_THRESHOLDS = [(0.50, "low"), (0.75, "moderate"), (0.90, "high"), (1.01, "critical")]

# Gates cycle congestion out of phase with each other so the dashboard
# always has a meaningful "redirect to quieter gate" story to tell.
_GATE_IDS = ["gate_n2", "gate_s1", "gate_e1", "gate_w1"]


@dataclass(frozen=True, slots=True)
class ZoneStatus:
    zone_id: str
    name: str
    capacity: int
    occupancy: int
    density: float  # 0.0–1.0+ fraction of capacity
    status: str


@dataclass(frozen=True, slots=True)
class GateStatus:
    gate_id: str
    name: str
    queue_length: int
    wait_minutes: int
    throughput_per_min: int


@dataclass(frozen=True, slots=True)
class Alert:
    severity: str  # "warning" | "critical"
    zone_id: str
    message: str
    recommendation: str


@dataclass(frozen=True, slots=True)
class CrowdSnapshot:
    match_minute: int
    phase: str
    zones: list[ZoneStatus]
    gates: list[GateStatus]
    alerts: list[Alert]


def phase_for(minute: int) -> str:
    if minute < -15:
        return "ingress"
    if minute < 0:
        return "pre_match"
    if minute < 45:
        return "first_half"
    if minute < 60:
        return "halftime"
    if minute < 105:
        return "second_half"
    return "egress"


def _wave(minute: int, salt: int) -> float:
    """Deterministic per-entity variation in [-0.12, +0.12]."""
    return 0.12 * math.sin((minute + salt * 17) / 9.0)


class CrowdService:
    def __init__(self, stadium: StadiumMap) -> None:
        self._stadium = stadium

    def current_match_minute(self) -> int:
        """Map wall-clock time onto the match timeline for a live demo feel."""
        elapsed = int(datetime.now(UTC).timestamp() // 60)
        return TIMELINE_START + (elapsed % _TIMELINE_LEN)

    def snapshot(self, match_minute: int | None = None) -> CrowdSnapshot:
        minute = self.current_match_minute() if match_minute is None else match_minute
        minute = max(TIMELINE_START, min(TIMELINE_END, minute))
        phase = phase_for(minute)
        base = _PHASE_BASE[phase]

        zones = []
        for salt, zone in enumerate(self._stadium.zones.values()):
            # Concourses drain into seating during play; plaza peaks around egress.
            modifier = 0.0
            if zone["id"] == "fan_plaza":
                modifier = 0.15 if phase in ("ingress", "egress") else -0.20
            density = max(0.02, min(1.0, base + _wave(minute, salt) + modifier))
            occupancy = int(zone["capacity"] * density)
            status = next(label for limit, label in _STATUS_THRESHOLDS if density < limit)
            zones.append(
                ZoneStatus(
                    zone_id=zone["id"],
                    name=zone["name"],
                    capacity=zone["capacity"],
                    occupancy=occupancy,
                    density=round(density, 3),
                    status=status,
                )
            )

        gates = []
        gate_pressure = {"ingress": 1.0, "pre_match": 0.7, "egress": 0.9}.get(phase, 0.15)
        for salt, gate_id in enumerate(_GATE_IDS):
            node = self._stadium.nodes[gate_id]
            load = max(0.0, gate_pressure + _wave(minute, salt + 40))
            queue = int(260 * load)
            throughput = 22 if load < 0.8 else 18  # security slows under crush
            gates.append(
                GateStatus(
                    gate_id=gate_id,
                    name=node["name"],
                    queue_length=queue,
                    wait_minutes=max(0, round(queue / throughput)),
                    throughput_per_min=throughput,
                )
            )

        return CrowdSnapshot(
            match_minute=minute,
            phase=phase,
            zones=zones,
            gates=gates,
            alerts=self._derive_alerts(zones, gates),
        )

    @staticmethod
    def _derive_alerts(zones: list[ZoneStatus], gates: list[GateStatus]) -> list[Alert]:
        alerts: list[Alert] = []
        for zone in zones:
            if zone.status == "critical":
                alerts.append(
                    Alert(
                        severity="critical",
                        zone_id=zone.zone_id,
                        message=f"{zone.name} at {zone.density:.0%} of capacity",
                        recommendation=(
                            "Hold inbound flow, open overflow routes, "
                            "and dispatch stewards immediately."
                        ),
                    )
                )
            elif zone.status == "high":
                alerts.append(
                    Alert(
                        severity="warning",
                        zone_id=zone.zone_id,
                        message=f"{zone.name} trending high ({zone.density:.0%})",
                        recommendation="Redirect fans to adjacent concourses via signage.",
                    )
                )
        quiet = min(gates, key=lambda g: g.queue_length)
        for gate in gates:
            if gate.wait_minutes >= 10 and gate.gate_id != quiet.gate_id:
                alerts.append(
                    Alert(
                        severity="warning",
                        zone_id=gate.gate_id,
                        message=f"{gate.name} queue ≈ {gate.wait_minutes} min",
                        recommendation=f"Divert arriving fans to {quiet.name}.",
                    )
                )
        return alerts

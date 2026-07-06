"""API contract tests: happy paths, validation, error mapping, and hardening."""


def test_health_reports_offline_chain(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["active_providers"] == ["mock"]


def test_stadium_map_lists_zones_and_nodes(client):
    body = client.get("/api/stadium/map").json()
    assert body["venue"]
    assert {"id", "name", "capacity"} <= set(body["zones"][0])
    assert any(node["kind"] == "gate" for node in body["nodes"])


def test_crowd_status_shape(client):
    body = client.get("/api/crowd/status", params={"match_minute": 50}).json()
    assert body["phase"] == "halftime"
    assert body["zones"] and body["gates"]
    assert {"zone_id", "density", "status"} <= set(body["zones"][0])


def test_crowd_status_rejects_out_of_range_minute(client):
    assert client.get("/api/crowd/status", params={"match_minute": 999}).status_code == 422


def test_chat_returns_reply_with_attribution(client):
    response = client.post(
        "/api/assistant/chat", json={"message": "Where is first aid?", "language": "fr"}
    )
    body = response.json()
    assert response.status_code == 200
    assert body["reply"]
    assert body["provider"] == "mock"
    assert body["language"] == "fr"


def test_chat_validation_rejects_bad_input(client):
    assert client.post("/api/assistant/chat", json={"message": ""}).status_code == 422
    assert client.post("/api/assistant/chat", json={"message": "x" * 1001}).status_code == 422
    assert (
        client.post(
            "/api/assistant/chat", json={"message": "hi", "language": "xx"}
        ).status_code
        == 422
    )


def test_navigate_accessible_round_trip(client):
    response = client.post(
        "/api/navigate",
        json={"origin": "gate_e1", "destination": "sec_201", "accessible": True},
    )
    body = response.json()
    assert response.status_code == 200
    assert body["accessible"] is True
    assert "stairs_e" not in [step["node_id"] for step in body["steps"]]
    assert body["directions"], "narration requested by default"


def test_navigate_without_narration_skips_llm(client):
    body = client.post(
        "/api/navigate",
        json={"origin": "plaza", "destination": "gate_e1", "narrate": False},
    ).json()
    assert body["directions"] is None
    assert body["provider"] is None


def test_navigate_unknown_location_is_404(client):
    response = client.post(
        "/api/navigate", json={"origin": "gate_e1", "destination": "narnia"}
    )
    assert response.status_code == 404


def test_navigate_rejects_injection_shaped_ids(client):
    response = client.post(
        "/api/navigate", json={"origin": "gate_e1", "destination": "a; rm -rf /"}
    )
    assert response.status_code == 422  # pattern guard, not a 404 lookup miss


def test_briefing_contains_actions_and_attribution(client):
    body = client.post("/api/ops/briefing", json={"match_minute": 50}).json()
    assert "PRIORITY" in body["briefing"]
    assert body["phase"] == "halftime"
    assert body["provider"] == "mock"


def test_security_headers_on_every_response(client):
    for path in ("/", "/api/health"):
        headers = client.get(path).headers
        assert headers["X-Content-Type-Options"] == "nosniff"
        assert headers["X-Frame-Options"] == "DENY"
        assert "Content-Security-Policy" in headers


def test_rate_limit_kicks_in(client, monkeypatch):
    from app.config import get_settings
    from app.main import create_app
    from fastapi.testclient import TestClient

    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "3")
    get_settings.cache_clear()
    with TestClient(create_app()) as limited:
        payload = {"message": "hola", "language": "es"}
        statuses = [
            limited.post("/api/assistant/chat", json=payload).status_code for _ in range(4)
        ]
    get_settings.cache_clear()
    assert statuses[:3] == [200, 200, 200]
    assert statuses[3] == 429


def test_unmetered_endpoints_ignore_rate_limit(client):
    assert all(client.get("/api/crowd/status").status_code == 200 for _ in range(40))

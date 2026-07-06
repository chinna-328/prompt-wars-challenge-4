"""Offline deterministic provider — final link in the chain.

Guarantees StadiumIQ is fully demoable with zero API keys and zero network:
it recognizes the task from the system prompt and returns realistic,
deterministic copy so every feature of the product remains exercisable.
"""

from app.providers.base import Completion, LLMProvider

_BRIEFING = (
    "OPERATIONS BRIEFING (demo mode — offline responder)\n"
    "1. PRIORITY — North concourse is trending toward heavy congestion. "
    "Redirect inbound fans from Gate N2 to Gates E1/W1 and stage 4 extra stewards.\n"
    "2. Concessions on Level 2 East show queue spillover into the walkway; "
    "open the auxiliary kiosk and add a queue barrier.\n"
    "3. Accessible routes are clear. Keep elevator EL-3 staffed through halftime.\n"
    "4. Egress plan: pre-position transit marshals 10 minutes before the final whistle."
)

_DIRECTIONS = (
    "Here is your route (demo mode — offline responder): head toward the main "
    "concourse and follow the overhead signs. The path avoids stairs where you asked "
    "for step-free access, and every turn is listed on screen. Stewards in yellow "
    "vests along the way can help at any point."
)

_CHAT = (
    "Happy to help! (demo mode — offline responder) I can guide you around the "
    "stadium, find food, restrooms, first aid, or your gate, explain today's match "
    "schedule, and answer in your preferred language once a live GenAI provider "
    "key is configured. Right now crowd levels are moderate — Gate E1 has the "
    "shortest queues."
)


class MockProvider(LLMProvider):
    name = "mock"

    def available(self) -> bool:
        return True

    async def complete(self, system: str, user: str) -> Completion:
        lowered = system.lower()
        if "operations briefing" in lowered:
            text = _BRIEFING
        elif "navigation narrator" in lowered:
            text = _DIRECTIONS
        else:
            text = _CHAT
        return Completion(text=text, provider=self.name, model="offline-deterministic")

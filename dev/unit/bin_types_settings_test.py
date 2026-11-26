"""Bin types in the personal settings: settings/set keeps the bin_types key, also an empty list.

  uv run --python 3.14 --with homeassistant python3 dev/unit/bin_types_settings_test.py

@deckt: custom_components/casora/settings.py#ws_set
"""

from __future__ import annotations

import asyncio
import inspect
import os
import sys
from types import SimpleNamespace

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

from custom_components.casora import settings  # noqa: E402


class FakeStore:
    saved = None

    async def async_load(self):
        # ws_set keeps unknown stored sections; an empty store has none.
        return None

    async def async_save(self, data):
        FakeStore.saved = data


def save(sent: dict) -> dict:
    """Run ws_set (without the websocket wrappers) and return what it stored."""
    hass = SimpleNamespace(data={settings.DOMAIN: {"settings_store": FakeStore()}})
    results = []
    conn = SimpleNamespace(send_result=lambda _id, res: results.append(res))
    asyncio.run(inspect.unwrap(settings.ws_set)(hass, conn, {"id": 1, "settings": sent}))
    assert results[0]["settings"] == FakeStore.saved
    return FakeStore.saved


assert "bin_types" in settings.SECTIONS
entry = {"words": ["groenbak"], "name": "Groene bak", "color": "#123456", "icon": "mdi:leaf"}
assert save({"bin_types": {"list": [entry]}}) == {"bin_types": {"list": [entry]}}
# An empty list is a choice (all bin types deleted), not "nothing set": it must stay.
assert save({"bin_types": {"list": []}}) == {"bin_types": {"list": []}}
# Absent stays absent: the ready-made list applies.
assert save({"waste": {"calendar": "calendar.x"}}) == {"waste": {"calendar": "calendar.x"}}
assert save({"bin_types": {}}) == {}
print("bin_types settings ok")

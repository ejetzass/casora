"""FlightRadar24 stub: a test-only stand-in for the HACS integration (domain flightradar24).

Why a stub and not casora_mock: text.set_value reaches only real entity objects of HA's text domain, and an entity
of casora_mock would carry the platform casora_mock, so Casora's detection by platform could not find it. This stub
creates real sensor, text and switch entities with the translation keys, entity categories and one device per config
entry that FlightRadar24 2.5.0 has (checked at its tag): sensor additional_tracked (attribute flights), text add_track
and remove_track, switch scanning. Two config entries are two instances.

Not the real thing: no network, no live traffic. Add and Remove change a list kept here; per instance the controls
can be told to succeed, ignore, delay or fail (service flightradar24.stub_set_mode), like the real one that only logs
on "not found" or an API error and returns normally. With the switch off, Add and Remove do nothing.

For a hand test, copy this folder into the Test HA config as `custom_components/flightradar24`;
no launcher loads it. The config key `flightradar24:` then creates entries:
`flightradar24:` alone is one instance, `instances: 2` are two. Set `omit_source: true`
to keep the controls but omit the source sensor for the missing-part case. Never in a house
with the real integration. The option is saved on first import; remove the entry or start a fresh
Test house to change it.
Device names are made up ("Flight tracker one"), so entity ids differ from those of any exported house.
"""
from __future__ import annotations

import asyncio
import copy
import json
from pathlib import Path

import voluptuous as vol

from homeassistant.config_entries import SOURCE_IMPORT, ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import HomeAssistantError

DOMAIN = "flightradar24"
PLATFORMS = ["sensor", "text", "switch"]
MODES = ("succeed", "ignore", "delay", "fail")
DELAY_SECONDS = 5
HERE = Path(__file__).parent


def _scenario() -> dict:
    return json.loads((HERE / "scenario.json").read_text(encoding="utf-8"))


class Tracker:
    """The tracked list of one instance and what its controls do."""

    def __init__(self, name: str, flights: list[dict], catalog: list[dict]) -> None:
        self.name = name
        self.flights = flights
        self.catalog = catalog
        self.mode = "succeed"
        self.scanning = True
        self._listeners: list = []

    @callback
    def listen(self, fn):
        self._listeners.append(fn)
        return lambda: self._listeners.remove(fn)

    @callback
    def changed(self) -> None:
        for fn in list(self._listeners):
            fn()

    async def _gate(self) -> bool:
        """False when the control must do nothing (switch off, ignore); delay and fail act here."""
        if not self.scanning or self.mode == "ignore":
            return False
        if self.mode == "fail":
            raise HomeAssistantError("Stub: the action was told to fail")
        if self.mode == "delay":
            await asyncio.sleep(DELAY_SECONDS)
        return True

    async def add(self, text: str) -> None:
        if not await self._gate():
            return
        key = text.strip().upper()
        # Known flight numbers come from the catalog; any other identifier is "not found": logged by the real one, nothing here.
        hit = next((c for c in self.catalog if key in (c["flight_number"], c["callsign"], c["aircraft_registration"])), None)
        if hit and not any(f["id"] == hit["id"] for f in self.flights):
            self.flights.append(copy.deepcopy(hit))
            self.changed()

    async def remove(self, text: str) -> None:
        if not await self._gate():
            return
        key = text.strip().upper()
        for i, f in enumerate(self.flights):
            if key and key in (f.get("flight_number"), f.get("callsign"), f.get("aircraft_registration")):
                del self.flights[i]  # the first match only, as the real one
                self.changed()
                return


async def async_setup(hass: HomeAssistant, config) -> bool:
    hass.data.setdefault(DOMAIN, {})

    async def set_mode(call: ServiceCall) -> None:
        wanted = (call.data.get("device") or "").strip().lower()
        for tracker in hass.data[DOMAIN].values():
            if not wanted or tracker.name.lower() == wanted:
                tracker.mode = call.data["mode"]

    hass.services.async_register(DOMAIN, "stub_set_mode", set_mode, schema=vol.Schema(
        {vol.Optional("device"): str, vol.Required("mode"): vol.In(MODES)}))
    if DOMAIN in config:
        options = config[DOMAIN] or {}
        count = int(options.get("instances", 1))
        omit_source = bool(options.get("omit_source", False))
        have = {e.unique_id for e in hass.config_entries.async_entries(DOMAIN)}
        for n in range(1, count + 1):
            if f"stub-{n}" not in have:
                hass.async_create_task(hass.config_entries.flow.async_init(
                    DOMAIN, context={"source": SOURCE_IMPORT}, data={"number": n, "omit_source": omit_source}))
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    scenario = await hass.async_add_executor_job(_scenario)
    rows = scenario["instances"]
    row = rows[(entry.data["number"] - 1) % len(rows)]
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = Tracker(
        row["name"], copy.deepcopy(row["flights"]), scenario["catalog"])
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return ok

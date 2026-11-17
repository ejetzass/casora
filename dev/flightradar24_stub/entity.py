"""Shared base: one device per config entry, identifiers (flightradar24, <unique id>) as in the real integration."""
from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity import Entity

from . import DOMAIN, Tracker


class StubEntity(Entity):
    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, entry: ConfigEntry, tracker: Tracker, key: str) -> None:
        self.tracker = tracker
        self._attr_translation_key = key
        self._attr_unique_id = f"{entry.unique_id}-{key}"
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, entry.unique_id)}, name=tracker.name, manufacturer="Stub")

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(self.tracker.listen(self.async_write_ha_state))

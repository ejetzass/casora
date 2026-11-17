"""text add_track / remove_track (entity category config): the value is cleared after each command, as in the real one."""
from __future__ import annotations

from homeassistant.components.text import TextEntity
from homeassistant.const import EntityCategory

from . import DOMAIN
from .entity import StubEntity


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    tracker = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([Control(entry, tracker, "add_track"), Control(entry, tracker, "remove_track")])


class Control(StubEntity, TextEntity):
    _attr_entity_category = EntityCategory.CONFIG
    _attr_native_value = ""

    async def async_set_value(self, value: str) -> None:
        if self._attr_translation_key == "add_track":
            await self.tracker.add(value)
        else:
            await self.tracker.remove(value)
        self._attr_native_value = ""
        self.async_write_ha_state()

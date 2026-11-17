"""switch scanning (API data fetching, entity category config): off = Add and Remove do nothing."""
from __future__ import annotations

from homeassistant.components.switch import SwitchEntity
from homeassistant.const import EntityCategory

from . import DOMAIN
from .entity import StubEntity


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    async_add_entities([Scanning(entry, hass.data[DOMAIN][entry.entry_id])])


class Scanning(StubEntity, SwitchEntity):
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, entry, tracker) -> None:
        super().__init__(entry, tracker, "scanning")

    @property
    def is_on(self) -> bool:
        return self.tracker.scanning

    async def async_turn_on(self, **kwargs) -> None:
        self.tracker.scanning = True
        self.tracker.changed()

    async def async_turn_off(self, **kwargs) -> None:
        self.tracker.scanning = False
        self.tracker.changed()

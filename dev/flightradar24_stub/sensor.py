"""sensor additional_tracked: state = number of tracked flights, attribute flights = the list (identity and live data)."""
from __future__ import annotations

from homeassistant.components.sensor import SensorEntity

from . import DOMAIN
from .entity import StubEntity


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    async_add_entities([Tracked(entry, hass.data[DOMAIN][entry.entry_id])])


class Tracked(StubEntity, SensorEntity):
    def __init__(self, entry, tracker) -> None:
        super().__init__(entry, tracker, "additional_tracked")

    @property
    def native_value(self) -> int:
        return len(self.tracker.flights)

    @property
    def extra_state_attributes(self) -> dict:
        return {
            "flights": list(self.tracker.flights),
            "flights_recorded": [{"id": f["id"], "flight_number": f.get("flight_number")} for f in self.tracker.flights],
        }

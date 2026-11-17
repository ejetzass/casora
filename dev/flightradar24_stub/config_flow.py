"""Config entries of the stub: one per instance, made by the YAML import in __init__.py."""
from homeassistant import config_entries

from . import DOMAIN


class StubFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_import(self, data=None):
        number = int((data or {}).get("number", 1))
        await self.async_set_unique_id(f"stub-{number}")
        self._abort_if_unique_id_configured()
        return self.async_create_entry(title=f"FlightRadar24 stub {number}", data={"number": number})

    async def async_step_user(self, _data=None):
        return await self.async_step_import()

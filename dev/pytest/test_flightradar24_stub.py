"""The FlightRadar24 stub (dev/flightradar24_stub): real entities with the contract's keys, one device per instance.

  uv run --python 3.14 --with pytest-homeassistant-custom-component pytest dev/pytest/test_flightradar24_stub.py -q

Test-only double of the HACS integration, for the Test HA (no launcher loads it in this branch). This checks the stub itself, so the
Test HA can be trusted as a stand-in: keys and categories, a device per config entry, the controls and their modes.
"""

from __future__ import annotations

import importlib
import json
import os
import subprocess
import sys
import tempfile

import pytest

from homeassistant import loader
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.setup import async_setup_component

STUB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "flightradar24_stub")
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))


@pytest.fixture(autouse=True, scope="module")
def stub_as_integration():
    """The stub folder as custom_components/flightradar24 (a namespace-package part on sys.path), without copying it."""
    with tempfile.TemporaryDirectory() as tmp:
        os.makedirs(os.path.join(tmp, "custom_components"))
        os.symlink(os.path.abspath(STUB), os.path.join(tmp, "custom_components", "flightradar24"))
        sys.path.append(tmp)
        importlib.invalidate_caches()
        yield
        sys.path.remove(tmp)
        importlib.invalidate_caches()


async def _setup(hass: HomeAssistant, instances: int, *, omit_source: bool = False):
    hass.data.pop(loader.DATA_CUSTOM_COMPONENTS, None)  # look at custom_components again, the stub is new
    assert await async_setup_component(hass, "flightradar24", {"flightradar24": {
        "instances": instances, "omit_source": omit_source}})
    await hass.async_block_till_done()
    return er.async_get(hass), dr.async_get(hass)


def _entity(reg, domain, key, unique_prefix):
    return next(e for e in reg.entities.values()
                if e.platform == "flightradar24" and e.domain == domain and e.translation_key == key
                and e.unique_id.startswith(unique_prefix))


async def test_contract_keys_categories_and_one_device_per_entry(hass: HomeAssistant) -> None:
    reg, devs = await _setup(hass, 2)
    mine = [e for e in reg.entities.values() if e.platform == "flightradar24"]
    assert sorted((e.domain, e.translation_key, e.entity_category) for e in mine if e.unique_id.startswith("stub-1")) == [
        ("sensor", "additional_tracked", None),
        ("switch", "scanning", EntityCategory.CONFIG),
        ("text", "add_track", EntityCategory.CONFIG),
        ("text", "remove_track", EntityCategory.CONFIG),
    ]
    one = {e.device_id for e in mine if e.unique_id.startswith("stub-1")}
    two = {e.device_id for e in mine if e.unique_id.startswith("stub-2")}
    assert len(one) == 1 and len(two) == 1 and one != two, "one device per config entry"
    assert next(iter(one)) and devs.async_get(next(iter(one))).identifiers == {("flightradar24", "stub-1")}
    # Neutral ids: nothing of an exported house.
    assert all("flightradar24_" not in e.entity_id for e in mine)
    assert not any(e.unique_id.startswith("stub-3") for e in mine)


async def test_missing_source_sensor_variant(hass: HomeAssistant) -> None:
    reg, _ = await _setup(hass, 1, omit_source=True)
    mine = [e for e in reg.entities.values() if e.platform == "flightradar24"]
    assert not any(e.domain == "sensor" and e.translation_key == "additional_tracked" for e in mine)
    assert any(e.domain == "text" and e.translation_key == "add_track" for e in mine)
    assert any(e.domain == "switch" and e.translation_key == "scanning" for e in mine)
    snapshot = {"entities": {e.entity_id: {
        "entity_id": e.entity_id, "platform": e.platform, "device_id": e.device_id,
        "translation_key": e.translation_key,
    } for e in mine}, "states": {}, "devices": {}}
    env = os.environ.copy()
    env["CASORA_FLIGHT_STUB_REGISTRY"] = json.dumps(snapshot)
    result = subprocess.run(["node", os.path.join(ROOT, "dev", "unit", "flights_studio.mjs")],
                            cwd=ROOT, env=env, text=True, capture_output=True, check=True)
    assert "ok flights_studio stub registry" in result.stdout


async def test_add_remove_scanning_and_modes(hass: HomeAssistant) -> None:
    reg, _ = await _setup(hass, 1)
    src = _entity(reg, "sensor", "additional_tracked", "stub-1").entity_id
    add = _entity(reg, "text", "add_track", "stub-1").entity_id
    rem = _entity(reg, "text", "remove_track", "stub-1").entity_id
    sw = _entity(reg, "switch", "scanning", "stub-1").entity_id
    numbers = lambda: [f["flight_number"] for f in hass.states.get(src).attributes["flights"]]  # noqa: E731
    assert numbers() == ["XY123", "XY456", "XY789"]

    async def text(entity, value):
        await hass.services.async_call("text", "set_value", {"entity_id": entity, "value": value}, blocking=True)

    await text(add, "xy900")
    assert numbers()[-1] == "XY900", "add upper-cases and merges"
    assert hass.states.get(add).state == "", "the control clears its value"
    await text(add, "xy900")
    assert numbers().count("XY900") == 1, "already tracked: no change"
    await text(add, "nothing-like-it")
    assert len(numbers()) == 4, "not found: returns normally, no change"
    await text(rem, "tst123")
    assert numbers() == ["XY456", "XY789", "XY900"], "remove by callsign, first match"

    await hass.services.async_call("switch", "turn_off", {"entity_id": sw}, blocking=True)
    await text(rem, "XY456")
    assert len(numbers()) == 3, "scanning off: Add and Remove do nothing"
    await hass.services.async_call("switch", "turn_on", {"entity_id": sw}, blocking=True)

    await hass.services.async_call("flightradar24", "stub_set_mode", {"mode": "ignore"}, blocking=True)
    await text(rem, "XY456")
    assert len(numbers()) == 3, "ignore"
    await hass.services.async_call("flightradar24", "stub_set_mode", {"mode": "fail"}, blocking=True)
    with pytest.raises(Exception):  # noqa: B017, PT011
        await text(rem, "XY456")
    assert len(numbers()) == 3
    await hass.services.async_call("flightradar24", "stub_set_mode", {"mode": "succeed"}, blocking=True)
    await text(rem, "XY456")
    assert numbers() == ["XY789", "XY900"]

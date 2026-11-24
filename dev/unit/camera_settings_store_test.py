"""The house-wide camera settings survive the settings store: the detection list, the
doorbell list, the ring switch of a camera and the house switch of the camera popup.

  uv run --python 3.14 --with homeassistant python dev/unit/camera_settings_store_test.py
"""

from __future__ import annotations

import asyncio
import inspect
import os
import sys
import unittest
from types import SimpleNamespace

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

from custom_components.casora import settings  # noqa: E402


class FakeStore:
    def __init__(self):
        self.saved = None

    async def async_load(self):
        return None

    async def async_save(self, value):
        self.saved = value


class Connection:
    def __init__(self):
        self.results = []

    def send_result(self, mid, value):
        self.results.append((mid, value))


class CameraSettingsStoreTest(unittest.IsolatedAsyncioTestCase):
    async def test_camera_triggers_are_saved_with_the_house_camera_record(self):
        store = FakeStore()
        connection = Connection()
        hass = SimpleNamespace(data={})
        settings_store = settings._store
        settings._store = lambda _hass: store
        try:
            message = {
                "id": 1,
                "type": "casora/settings/set",
                "settings": {
                    "scenes": {"exclude": ["scene.olive"]},
                    "cameras": [{
                        "device_id": "garden",
                        "entity_id": "camera.garden",
                        "name": "Garden",
                        "detection_triggers": ["binary_sensor.garden_person", "event.garden_motion"],
                    }],
                    "unknown": {"ignored": True},
                },
            }
            await inspect.unwrap(settings.ws_set)(hass, connection, message)
        finally:
            settings._store = settings_store

        expected = {
            "scenes": {"exclude": ["scene.olive"]},
            "cameras": [{
                "device_id": "garden",
                "entity_id": "camera.garden",
                "name": "Garden",
                "detection_triggers": ["binary_sensor.garden_person", "event.garden_motion"],
            }],
        }
        self.assertEqual(store.saved, expected)
        self.assertEqual(connection.results, [(1, {"settings": expected, "stored": True})])


    async def test_camera_record_keeps_identity_and_triggers_only(self):
        store = FakeStore()
        connection = Connection()
        hass = SimpleNamespace(data={})
        settings_store = settings._store
        settings._store = lambda _hass: store
        try:
            message = {
                "id": 2,
                "type": "casora/settings/set",
                "settings": {
                    "cameras": [
                        {
                            "device_id": "garden",
                            "entity_id": "camera.garden",
                            "name": "Garden",
                            "detection_triggers": ["binary_sensor.garden_person", 7, "", None],
                            "stream_url": "rtsp://mock.invalid/stream",
                            "snapshot": {"path": "/config/www/garden.jpg"},
                        },
                        {"entity_id": None, "name": "No identity"},
                        "camera.loose",
                    ],
                },
            }
            await inspect.unwrap(settings.ws_set)(hass, connection, message)
        finally:
            settings._store = settings_store

        expected = {
            "cameras": [{
                "device_id": "garden",
                "entity_id": "camera.garden",
                "name": "Garden",
                "detection_triggers": ["binary_sensor.garden_person"],
            }],
        }
        self.assertEqual(store.saved, expected)
        self.assertEqual(connection.results, [(2, {"settings": expected, "stored": True})])

    async def test_empty_and_duplicate_cameras_and_triggers_are_dropped(self):
        store = FakeStore()
        connection = Connection()
        hass = SimpleNamespace(data={})
        settings_store = settings._store
        settings._store = lambda _hass: store
        try:
            message = {
                "id": 3,
                "type": "casora/settings/set",
                "settings": {
                    "cameras": [
                        {"entity_id": "camera.garden", "detection_triggers": ["binary_sensor.a", "binary_sensor.a", "event.b"]},
                        {"entity_id": "", "name": "Empty camera", "detection_triggers": ["binary_sensor.c"]},
                        {"entity_id": "camera.garden", "name": "Duplicate camera"},
                        {"entity_id": "camera.porch", "detection_triggers": ["binary_sensor.a"]},
                    ],
                },
            }
            await inspect.unwrap(settings.ws_set)(hass, connection, message)
        finally:
            settings._store = settings_store

        expected = {
            "cameras": [
                {"entity_id": "camera.garden", "detection_triggers": ["binary_sensor.a", "event.b"]},
                {"entity_id": "camera.porch", "detection_triggers": ["binary_sensor.a"]},
            ],
        }
        self.assertEqual(store.saved, expected)

    async def test_duplicate_camera_adds_its_triggers_to_the_first(self):
        store = FakeStore()
        connection = Connection()
        hass = SimpleNamespace(data={})
        settings_store = settings._store
        settings._store = lambda _hass: store
        try:
            message = {
                "id": 4,
                "type": "casora/settings/set",
                "settings": {
                    "cameras": [
                        {"entity_id": "camera.garden", "name": "Garden"},
                        {"entity_id": "camera.garden", "name": "Duplicate", "detection_triggers": ["event.b", "binary_sensor.a"]},
                        {"entity_id": "camera.garden", "detection_triggers": ["binary_sensor.a", "event.c"]},
                    ],
                },
            }
            await inspect.unwrap(settings.ws_set)(hass, connection, message)
        finally:
            settings._store = settings_store

        expected = {
            "cameras": [
                {"entity_id": "camera.garden", "name": "Garden",
                 "detection_triggers": ["event.b", "binary_sensor.a", "event.c"]},
            ],
        }
        self.assertEqual(store.saved, expected)


    async def test_camera_status_is_saved_with_the_house_camera_record(self):
        store = FakeStore()
        connection = Connection()
        hass = SimpleNamespace(data={})
        settings_store = settings._store
        settings._store = lambda _hass: store
        try:
            message = {
                "id": 1,
                "type": "casora/settings/set",
                "settings": {
                    "scenes": {"exclude": ["scene.olive"]},
                    "cameras": [{
                        "device_id": "garden",
                        "entity_id": "camera.garden",
                        "name": "Garden",
                        "status_entity": "binary_sensor.garden_connected",
                    }],
                    "unknown": {"ignored": True},
                },
            }
            await inspect.unwrap(settings.ws_set)(hass, connection, message)
        finally:
            settings._store = settings_store

        expected = {
            "scenes": {"exclude": ["scene.olive"]},
            "cameras": [{
                "device_id": "garden",
                "entity_id": "camera.garden",
                "name": "Garden",
                "status_entity": "binary_sensor.garden_connected",
            }],
        }
        self.assertEqual(store.saved, expected)
        self.assertEqual(connection.results, [(1, {"settings": expected, "stored": True})])

    def test_popup_camera_record_from_the_old_popup_is_kept_unchanged(self):
        # Records the popup Studio saved before the rebuild: they must load and save as they are.
        records = [
            {
                "device_id": "garden",
                "entity_id": "camera.garden",
                "name": "Garden",
                "doorbell_triggers": ["event.garden_bell"],
                "detection_triggers": ["binary_sensor.garden_motion"],
                "open_on_ring": True,
                "open_on_detection": True,
                "status_entity": "binary_sensor.garden_connected",
            },
            {"device_id": None, "entity_id": "camera.porch", "name": "Porch"},
        ]
        self.assertEqual(settings.camera_records(records), records)

    async def test_the_house_switch_and_the_camera_ring_switch_survive_the_store(self):
        store = FakeStore()
        connection = Connection()
        hass = SimpleNamespace(data={})
        settings_store = settings._store
        settings._store = lambda _hass: store
        try:
            message = {
                "id": 3,
                "type": "casora/settings/set",
                "settings": {
                    "camera_popup": {"open_by_itself": True},
                    "cameras": [{
                        "device_id": "garden",
                        "entity_id": "camera.garden",
                        "name": "Garden",
                        "doorbell_triggers": ["event.garden_bell"],
                        "detection_triggers": ["binary_sensor.garden_person"],
                        "open_on_ring": False,
                        "open_on_detection": True,
                    }],
                },
            }
            await inspect.unwrap(settings.ws_set)(hass, connection, message)
        finally:
            settings._store = settings_store

        expected = {
            "camera_popup": {"open_by_itself": True},
            "cameras": [{
                "device_id": "garden",
                "entity_id": "camera.garden",
                "name": "Garden",
                "doorbell_triggers": ["event.garden_bell"],
                "detection_triggers": ["binary_sensor.garden_person"],
                "open_on_ring": False,
                "open_on_detection": True,
            }],
        }
        self.assertEqual(store.saved, expected)
        self.assertEqual(connection.results, [(3, {"settings": expected, "stored": True})])

    async def test_without_the_house_switch_no_camera_popup_section_is_stored(self):
        store = FakeStore()
        connection = Connection()
        hass = SimpleNamespace(data={})
        settings_store = settings._store
        settings._store = lambda _hass: store
        try:
            message = {
                "id": 4,
                "type": "casora/settings/set",
                "settings": {"cameras": [{"entity_id": "camera.garden"}]},
            }
            await inspect.unwrap(settings.ws_set)(hass, connection, message)
        finally:
            settings._store = settings_store

        self.assertEqual(store.saved, {"cameras": [{"entity_id": "camera.garden"}]})
        self.assertIn("camera_popup", settings.SECTIONS, "the house switch has its own section")

    async def test_detection_switch_keeps_only_booleans(self):
        for value, expected in [(False, False), (True, True), ("true", None)]:
            store = FakeStore()
            connection = Connection()
            hass = SimpleNamespace(data={})
            original = settings._store
            settings._store = lambda _hass: store
            try:
                await inspect.unwrap(settings.ws_set)(hass, connection, {
                    "id": 6, "type": "casora/settings/set",
                    "settings": {"cameras": [{"entity_id": "camera.garden", "open_on_detection": value}]},
                })
            finally:
                settings._store = original
            record = store.saved["cameras"][0]
            self.assertEqual(record.get("open_on_detection"), expected)
            self.assertEqual("open_on_detection" in record, expected is not None)

    async def test_an_off_house_switch_stores_nothing_and_unknown_keys_are_dropped(self):
        store = FakeStore()
        connection = Connection()
        hass = SimpleNamespace(data={})
        settings_store = settings._store
        settings._store = lambda _hass: store
        try:
            message = {
                "id": 5,
                "type": "casora/settings/set",
                "settings": {
                    "camera_popup": {"open_by_itself": False, "unknown": True},
                    "cameras": [{"entity_id": "camera.garden"}],
                },
            }
            await inspect.unwrap(settings.ws_set)(hass, connection, message)
        finally:
            settings._store = settings_store

        expected = {"cameras": [{"entity_id": "camera.garden"}]}
        self.assertEqual(store.saved, expected, "an off house switch stores nothing")
        self.assertEqual(connection.results, [(5, {"settings": expected, "stored": True})])


if __name__ == "__main__":
    unittest.main()

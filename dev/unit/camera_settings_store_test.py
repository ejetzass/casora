"""The house-wide camera list survives the settings store: triggers, popup switches and the status sensor.

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


if __name__ == "__main__":
    unittest.main()

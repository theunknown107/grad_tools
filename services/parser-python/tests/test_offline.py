"""
The offline guarantee: parsing works with the network made unreachable, and
the package imports no networking module at all.
"""

from __future__ import annotations

import json
import pathlib
import re
import socket
import unittest
from unittest import mock

from gradtools_parser import Placed, parse_document, parse_timetable

PACKAGE = pathlib.Path(__file__).parent.parent / "gradtools_parser"
FIXTURES = pathlib.Path(__file__).parent / "fixtures"


def _refuse(*_args, **_kwargs):
    raise AssertionError("the parser attempted a network operation")


class OfflineTest(unittest.TestCase):
    def test_every_fixture_parses_with_the_network_unreachable(self):
        with mock.patch.object(socket, "socket", _refuse), \
             mock.patch.object(socket, "create_connection", _refuse), \
             mock.patch.object(socket, "getaddrinfo", _refuse):
            for path in sorted(FIXTURES.glob("*.json")):
                record = json.loads(path.read_text(encoding="utf-8"))
                placed = [Placed.from_dict(item) for item in record["placed"]]
                for recovery in (False, True):
                    with self.subTest(fixture=path.stem, recovery=recovery):
                        parse_document(placed, lines=record["lines"], recovery=recovery)
                        parse_timetable(placed, recovery=recovery)

    def test_the_package_imports_no_networking_module(self):
        network = re.compile(r"^\s*(?:import|from)\s+(socket|ssl|http|urllib|requests|httpx|aiohttp)\b", re.M)
        for source in PACKAGE.glob("*.py"):
            with self.subTest(module=source.name):
                self.assertIsNone(network.search(source.read_text(encoding="utf-8")))


if __name__ == "__main__":
    unittest.main()

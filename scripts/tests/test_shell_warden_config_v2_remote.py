from __future__ import annotations

import unittest
from dataclasses import dataclass

from scripts.shell_warden_config_v2_drift import GrammarError
from scripts.shell_warden_config_v2_remote import (
    MAX_RESPONSE_BYTES,
    NETWORK_TIMEOUT_SECONDS,
    Connection,
    ConnectionFactory,
    Response,
    fetch_text,
)


@dataclass(frozen=True, slots=True)
class FakeResponse:
    status: int
    payload: bytes = b""

    def read(self, amount: int | None = None) -> bytes:
        if amount is None:
            return self.payload
        return self.payload[:amount]


@dataclass(frozen=True, slots=True)
class FakeConnection:
    response: Response
    request_error: OSError | None = None

    def request(self, method: str, url: str, *, headers: dict[str, str]) -> None:
        del method, url, headers
        if self.request_error is not None:
            raise self.request_error

    def getresponse(self) -> Response:
        return self.response

    def close(self) -> None:
        return None


class RemoteFetchTests(unittest.TestCase):
    def factory(self, connection: Connection) -> ConnectionFactory:
        def create(host: str, *, timeout: float) -> Connection:
            self.assertEqual("example.test", host)
            self.assertEqual(NETWORK_TIMEOUT_SECONDS, timeout)
            return connection

        return create

    def test_http_failure_is_controlled(self) -> None:
        connection = FakeConnection(FakeResponse(status=503))

        with self.assertRaisesRegex(GrammarError, "returned 503"):
            _ = fetch_text("example.test", "/grammar.rs", self.factory(connection))

    def test_decode_failure_is_controlled(self) -> None:
        connection = FakeConnection(FakeResponse(status=200, payload=b"\xff"))

        with self.assertRaisesRegex(GrammarError, "failed to fetch"):
            _ = fetch_text("example.test", "/grammar.rs", self.factory(connection))

    def test_timeout_is_controlled(self) -> None:
        connection = FakeConnection(FakeResponse(status=200), TimeoutError("timed out"))

        with self.assertRaisesRegex(GrammarError, "timed out"):
            _ = fetch_text("example.test", "/grammar.rs", self.factory(connection))

    def test_oversized_response_is_controlled(self) -> None:
        payload = b"x" * (MAX_RESPONSE_BYTES + 1)
        connection = FakeConnection(FakeResponse(status=200, payload=payload))

        with self.assertRaisesRegex(GrammarError, "exceeded"):
            _ = fetch_text("example.test", "/grammar.rs", self.factory(connection))


if __name__ == "__main__":
    _ = unittest.main()

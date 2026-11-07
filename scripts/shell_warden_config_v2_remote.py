from __future__ import annotations

import re
from contextlib import closing
from http import HTTPStatus
from http.client import HTTPException, HTTPSConnection
from typing import Final, Protocol

from scripts.shell_warden_config_v2_drift import GrammarError

API_HOST: Final = "api.github.com"
COMMIT_PATH: Final = "/repos/agent-guardrails/shell-warden/commits/main"
RAW_HOST: Final = "raw.githubusercontent.com"
GRAMMAR_PATH: Final = "/agent-guardrails/shell-warden/{sha}/src/checker/grammar.rs"
NETWORK_TIMEOUT_SECONDS: Final = 10.0
MAX_RESPONSE_BYTES: Final = 2_000_000


class Response(Protocol):
    @property
    def status(self) -> int: ...

    def read(self, amount: int | None = None) -> bytes: ...


class Connection(Protocol):
    def request(self, method: str, url: str, *, headers: dict[str, str]) -> None: ...

    def getresponse(self) -> Response: ...

    def close(self) -> None: ...


class ConnectionFactory(Protocol):
    def __call__(self, host: str, *, timeout: float) -> Connection: ...


def fetch_text(host: str, path: str, connection_factory: ConnectionFactory | None = None) -> str:
    url = f"https://{host}{path}"
    try:
        connection = (
            HTTPSConnection(host, timeout=NETWORK_TIMEOUT_SECONDS)
            if connection_factory is None
            else connection_factory(host, timeout=NETWORK_TIMEOUT_SECONDS)
        )
        with closing(connection):
            connection.request(
                "GET",
                path,
                headers={"User-Agent": "agent-guardrails-docs-drift-guard"},
            )
            response = connection.getresponse()
            if response.status != HTTPStatus.OK:
                raise GrammarError(f"GET {url} returned {response.status}")
            payload = response.read(MAX_RESPONSE_BYTES + 1)
            if len(payload) > MAX_RESPONSE_BYTES:
                raise GrammarError(f"GET {url} exceeded {MAX_RESPONSE_BYTES} bytes")
            return payload.decode("utf-8")
    except (HTTPException, OSError, UnicodeDecodeError) as error:
        raise GrammarError(f"failed to fetch {url}: {error}") from error


def remote_main() -> tuple[str, str]:
    metadata = fetch_text(API_HOST, COMMIT_PATH)
    match = re.search(r'"sha"\s*:\s*"([0-9a-f]{40})"', metadata)
    if match is None:
        raise GrammarError("GitHub main response did not contain a commit SHA")
    sha = match.group(1)
    return fetch_text(RAW_HOST, GRAMMAR_PATH.format(sha=sha)), sha

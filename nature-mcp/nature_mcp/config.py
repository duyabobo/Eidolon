"""nature-mcp 运行配置（全部来自环境变量）。"""
from __future__ import annotations

import os
from dataclasses import dataclass


DEFAULT_HTTP_PORT = 8082
DEFAULT_REQUEST_TIMEOUT_SECONDS = 30.0
DEFAULT_USER_AGENT = "nature-mcp/0.1 (Eidolon; mailto:nature-mcp@localhost)"


@dataclass(frozen=True)
class Settings:
    transport: str  # stdio | streamable-http | http
    host: str
    port: int
    allowed_hosts: tuple[str, ...]
    openalex_email: str
    unpaywall_email: str
    s2_api_key: str
    request_timeout_seconds: float
    user_agent: str
    log_level: str


def load_settings() -> Settings:
    transport = os.environ.get("TRANSPORT", "stdio").strip().lower()
    if transport == "http":
        transport = "streamable-http"

    allowed_raw = os.environ.get(
        "ALLOWED_HOSTS",
        "nature-mcp,nature-mcp:8082,localhost,localhost:8082,127.0.0.1,127.0.0.1:8082",
    )
    allowed_hosts = tuple(item.strip() for item in allowed_raw.split(",") if item.strip())

    email = (
        os.environ.get("OPENALEX_EMAIL")
        or os.environ.get("UNPAYWALL_EMAIL")
        or "nature-mcp@localhost"
    ).strip()

    return Settings(
        transport=transport,
        host=os.environ.get("HOST", "127.0.0.1").strip(),
        port=int(os.environ.get("PORT", str(DEFAULT_HTTP_PORT))),
        allowed_hosts=allowed_hosts,
        openalex_email=email,
        unpaywall_email=email,
        s2_api_key=os.environ.get("S2_API_KEY", "").strip(),
        request_timeout_seconds=float(
            os.environ.get("REQUEST_TIMEOUT", str(DEFAULT_REQUEST_TIMEOUT_SECONDS))
        ),
        user_agent=os.environ.get("USER_AGENT", DEFAULT_USER_AGENT).strip(),
        log_level=os.environ.get("LOG_LEVEL", "INFO").strip().upper(),
    )


# 常用期刊：OpenAlex source id + ISSN，避免仅靠 display_name 模糊匹配
KNOWN_JOURNALS: dict[str, dict[str, str]] = {
    "nature": {
        "openalex_id": "S137773608",
        "issn": "0028-0836",
        "display_name": "Nature",
    },
    "science": {
        "openalex_id": "S3880285",
        "issn": "0036-8075",
        "display_name": "Science",
    },
    "nature communications": {
        "openalex_id": "S112059722",
        "issn": "2041-1723",
        "display_name": "Nature Communications",
    },
    "nature medicine": {
        "openalex_id": "S151207988",
        "issn": "1078-8956",
        "display_name": "Nature Medicine",
    },
    "cell": {
        "openalex_id": "S64147156",
        "issn": "0092-8674",
        "display_name": "Cell",
    },
    "pnas": {
        "openalex_id": "S201996469",
        "issn": "0027-8424",
        "display_name": "Proceedings of the National Academy of Sciences",
    },
}

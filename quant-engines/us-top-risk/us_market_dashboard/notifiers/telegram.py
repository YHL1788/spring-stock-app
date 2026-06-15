"""
Telegram Notifier
推送到 Telegram，沿用 OpenClaw / 俊靓 风格
"""
import logging
import requests

from us_market_dashboard.config.settings import (
    TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_ENABLED, HTTP_TIMEOUT,
)

logger = logging.getLogger(__name__)


def send_message(text: str, parse_mode: str = "HTML",
                 disable_preview: bool = True) -> bool:
    """发送一条 Telegram 消息"""
    if not TELEGRAM_ENABLED:
        logger.warning("Telegram not configured, message dropped:")
        logger.warning(text[:500])
        return False

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    # Telegram 限制 4096 字符，自动切片
    chunks = _chunk(text, 4000)
    ok = True
    for chunk in chunks:
        try:
            resp = requests.post(url, json={
                "chat_id": TELEGRAM_CHAT_ID,
                "text": chunk,
                "parse_mode": parse_mode,
                "disable_web_page_preview": disable_preview,
            }, timeout=HTTP_TIMEOUT)
            if resp.status_code != 200:
                logger.error(f"Telegram error: {resp.status_code} {resp.text}")
                ok = False
        except Exception as e:
            logger.error(f"Telegram send failed: {e}")
            ok = False
    return ok


def _chunk(text: str, size: int):
    """按行切片，尽量保持完整行"""
    if len(text) <= size:
        return [text]
    out, buf = [], []
    cur = 0
    for line in text.split("\n"):
        if cur + len(line) + 1 > size and buf:
            out.append("\n".join(buf))
            buf, cur = [], 0
        buf.append(line)
        cur += len(line) + 1
    if buf:
        out.append("\n".join(buf))
    return out

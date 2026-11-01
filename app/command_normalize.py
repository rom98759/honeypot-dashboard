"""
Normalize attacker commands so variants of one bot compare equal.

Bots stamp each run with throwaway values (a random `check_<hex>` marker, a
fresh /tmp directory, a rotating download host). Replacing those with fixed
tokens leaves the part that identifies the tool. Stable values such as an
embedded SSH key are kept on purpose: they are the bot's signature.
"""

import hashlib
import re

# Bounded by non-alphanumerics so a hex-looking stretch inside a base64 key is left alone.
_HEX_RUN = re.compile(r"(?<![0-9A-Za-z])[0-9a-fA-F]{8,}(?![0-9A-Za-z])")
_IPV4 = re.compile(r"(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])")
_TEMP_ENTRY = re.compile(r"(/tmp/|/var/tmp/|/dev/shm/)[^\s/;&|'\"`]+")
_SPACES = re.compile(r"\s+")
# Bots probe for fake shells with a random sum like "$((593*647+9))".
_ARITHMETIC = re.compile(r"\$\(\(([^()]*)\)\)")
_DIGITS = re.compile(r"\d+")


def normalize_command(text: str) -> str:
    text = _ARITHMETIC.sub(lambda m: "$((" + _DIGITS.sub("<N>", m[1]) + "))", text)
    text = _TEMP_ENTRY.sub(r"\1<TMP>", text)
    text = _IPV4.sub("<IP>", text)
    text = _HEX_RUN.sub("<HEX>", text)
    return _SPACES.sub(" ", text).strip()


def family_key(commands: list[str]) -> str | None:
    """Identity of a command sequence once normalized; order matters, a bot's
    script is a sequence. None when the session ran nothing."""
    if not commands:
        return None
    joined = "\n".join(normalize_command(c) for c in commands)
    return hashlib.sha256(joined.encode()).hexdigest()

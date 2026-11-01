"""
Normalize attacker commands so variants of one bot compare equal.

Bots stamp each run with throwaway values (a random `check_<hex>` marker, a
fresh /tmp directory, a rotating download host). Replacing those with fixed
tokens leaves the part that identifies the tool. Stable values such as an
embedded SSH key are kept on purpose: they are the bot's signature.
"""

import hashlib
import re
from functools import lru_cache

# Bounded by non-alphanumerics so a hex-looking stretch inside a base64 key is left alone.
_HEX_RUN = re.compile(r"(?<![0-9A-Za-z])[0-9a-fA-F]{8,}(?![0-9A-Za-z])")
_IPV4 = re.compile(r"(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])")
_TEMP_ENTRY = re.compile(r"(/tmp/|/var/tmp/|/dev/shm/)[^\s/;&|'\"`]+")
_SPACES = re.compile(r"\s+")
# Bots probe for fake shells with a random sum like "$((593*647+9))".
_ARITHMETIC = re.compile(r"\$\(\(([^()]*)\)\)")
_DIGITS = re.compile(r"\d+")
# Bots replay the password they just logged in with to escalate through sudo.
_SUDO_PASSWORD = re.compile(r"echo\s+(['\"])[^'\"]*\1(\s*\|\s*sudo\s+-S)")


# ...and set a random new one ("echo root:<random>|chpasswd"); the targeted user is kept.
_NEW_PASSWORD = re.compile(r"echo\s+(['\"])([^:'\"]+):[^'\"]*\1(\s*\|\s*chpasswd)")


# The same bot lines recur across hundreds of sample sessions.
@lru_cache(maxsize=65536)
def normalize_command(text: str) -> str:
    text = _SUDO_PASSWORD.sub(r"echo '<PASS>'\2", text)
    text = _NEW_PASSWORD.sub(r"echo \1\2:<PASS>\1\3", text)
    text = _ARITHMETIC.sub(lambda m: "$((" + _DIGITS.sub("<N>", m[1]) + "))", text)
    text = _TEMP_ENTRY.sub(r"\1<TMP>", text)
    text = _IPV4.sub("<IP>", text)
    text = _HEX_RUN.sub("<HEX>", text)
    return _SPACES.sub(" ", text).strip()


def normalize_sequence(commands: list[str]) -> tuple[str, ...]:
    return tuple(normalize_command(c) for c in commands)


def sequence_key(sequence: tuple[str, ...]) -> str | None:
    """Identity of an already normalized sequence; None when the session ran nothing."""
    if not sequence:
        return None
    return hashlib.sha256("\n".join(sequence).encode()).hexdigest()


def family_key(commands: list[str]) -> str | None:
    """Identity of a command sequence once normalized; order matters, a bot's
    script is a sequence. None when the session ran nothing."""
    return sequence_key(normalize_sequence(commands))

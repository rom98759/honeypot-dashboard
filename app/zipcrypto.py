"""
Single-file zip with traditional PKWARE encryption ("ZipCrypto"), the format malware
repositories use with the password "infected": every unzip tool opens it, and antivirus
software leaves it alone. The cipher is weak by design here; it only keeps a sample from
being scanned, quarantined or run by accident. The standard library reads such archives
but cannot write them, hence this small writer.
"""

import os
import struct
import zlib
from datetime import datetime

_CRC_TABLE = []
for _i in range(256):
    _c = _i
    for _ in range(8):
        _c = (_c >> 1) ^ 0xEDB88320 if _c & 1 else _c >> 1
    _CRC_TABLE.append(_c)

_FLAG_ENCRYPTED = 0x0001
_METHOD_DEFLATE = 8
_VERSION = 20


def _encrypt(data: bytes, password: bytes) -> bytes:
    # Locals only: this loop runs once per byte (a few MB/s in CPython).
    t = _CRC_TABLE
    k0, k1, k2 = 0x12345678, 0x23456789, 0x34567890
    for p in password:
        k0 = (k0 >> 8) ^ t[(k0 ^ p) & 0xFF]
        k1 = ((k1 + (k0 & 0xFF)) * 134775813 + 1) & 0xFFFFFFFF
        k2 = (k2 >> 8) ^ t[(k2 ^ (k1 >> 24)) & 0xFF]
    out = bytearray(len(data))
    for i, p in enumerate(data):
        tmp = (k2 | 2) & 0xFFFF
        out[i] = p ^ (((tmp * (tmp ^ 1)) >> 8) & 0xFF)
        k0 = (k0 >> 8) ^ t[(k0 ^ p) & 0xFF]
        k1 = ((k1 + (k0 & 0xFF)) * 134775813 + 1) & 0xFFFFFFFF
        k2 = (k2 >> 8) ^ t[(k2 ^ (k1 >> 24)) & 0xFF]
    return bytes(out)


def _dos_datetime(when: datetime) -> tuple[int, int]:
    year = min(max(when.year, 1980), 2107)
    time = (when.hour << 11) | (when.minute << 5) | (when.second // 2)
    date = ((year - 1980) << 9) | (when.month << 5) | when.day
    return time, date


def encrypted_zip(name: str, data: bytes, password: bytes, when: datetime | None = None) -> bytes:
    """Return a zip archive holding `data` as `name`, deflated then encrypted with `password`."""
    encoded_name = name.encode("ascii")
    crc = zlib.crc32(data) & 0xFFFFFFFF
    compressor = zlib.compressobj(6, zlib.DEFLATED, -15)
    compressed = compressor.compress(data) + compressor.flush()
    # The 12-byte encryption header ends with the CRC's high byte: that is how unzip
    # tells a wrong password before decompressing anything.
    header = os.urandom(11) + bytes([crc >> 24])
    payload = _encrypt(header + compressed, password)
    dos_time, dos_date = _dos_datetime(when or datetime.now())

    local = struct.pack(
        "<IHHHHHIIIHH",
        0x04034B50, _VERSION, _FLAG_ENCRYPTED, _METHOD_DEFLATE, dos_time, dos_date,
        crc, len(payload), len(data), len(encoded_name), 0,
    ) + encoded_name
    central = struct.pack(
        "<IHHHHHHIIIHHHHHII",
        0x02014B50, _VERSION, _VERSION, _FLAG_ENCRYPTED, _METHOD_DEFLATE, dos_time, dos_date,
        crc, len(payload), len(data), len(encoded_name), 0, 0, 0, 0, 0, 0,
    ) + encoded_name
    central_offset = len(local) + len(payload)
    end = struct.pack("<IHHHHIIH", 0x06054B50, 0, 0, 1, 1, len(central), central_offset, 0)
    return local + payload + central + end

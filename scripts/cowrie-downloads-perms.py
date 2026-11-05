#!/usr/bin/python3
"""
/usr/local/sbin/cowrie-downloads-perms.py DOWNLOADS_DIR

Cowrie stores captured files as mode 0600, so the dashboard container (another uid)
cannot read them to build the "infected" zip. This adds the read bit for others to
each sample. Docker's volume root (/var/lib/docker) is 0710 root, so no host user
gains access by it.

Runs as root on a directory the honeypot container can write: it never follows a
link, touches only regular files named like a SHA-256 and owned by the directory's
owner, skips hard links (a planted link to a root file), and drops setuid/setgid bits.
"""

import os
import re
import stat
import sys

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def fix(directory: str) -> int:
    dfd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    changed = 0
    try:
        owner = os.fstat(dfd).st_uid
        for name in os.listdir(dfd):
            if not SHA256_RE.match(name):
                continue
            try:
                # O_PATH: inspect the inode without opening its content.
                fd = os.open(name, os.O_PATH | os.O_NOFOLLOW, dir_fd=dfd)
            except OSError:
                continue
            try:
                st = os.fstat(fd)
                if not stat.S_ISREG(st.st_mode) or st.st_uid != owner or st.st_nlink != 1:
                    continue
                mode = stat.S_IMODE(st.st_mode)
                wanted = (mode | stat.S_IROTH) & ~(stat.S_ISUID | stat.S_ISGID)
                if wanted != mode:
                    # chmod through /proc acts on the inode already checked, not on the name.
                    os.chmod(f"/proc/self/fd/{fd}", wanted)
                    changed += 1
            finally:
                os.close(fd)
    finally:
        os.close(dfd)
    return changed


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: cowrie-downloads-perms.py DOWNLOADS_DIR", file=sys.stderr)
        return 2
    try:
        changed = fix(sys.argv[1])
    except FileNotFoundError:
        return 0  # Cowrie has not captured anything yet
    if changed:
        print(f"cowrie-downloads-perms: made {changed} file(s) readable")
    return 0


if __name__ == "__main__":
    sys.exit(main())

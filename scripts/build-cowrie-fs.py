#!/usr/bin/env python3
"""Derive cowrie/fs.pickle from the filesystem pickle bundled in the Cowrie image.

The bundled pickle is a Debian 12 tree, but it carries two well-known Cowrie tells:
the hostname `svr04` and a `phil` account (`Phil California`). This rewrites both so the fake
shell stays consistent with `hostname` in cowrie/cowrie.cfg.

    cid=$(docker create "$COWRIE_IMAGE")
    docker cp "$cid:/cowrie/cowrie-git/src/cowrie/data/fs.pickle" /tmp/fs.orig.pickle
    docker rm "$cid"
    python3 scripts/build-cowrie-fs.py /tmp/fs.orig.pickle cowrie/fs.pickle

Node layout (Cowrie's `fs.py`): [name, type, uid, gid, size, mode, ctime, contents, target, realfile]
with type 1 = directory (contents = children) and type 2 = file (contents = bytes).
"""

import argparse
import pickle
import sys

A_NAME, A_TYPE, A_SIZE, A_CONTENTS = 0, 1, 4, 7
T_DIR, T_FILE = 1, 2

OLD_HOSTNAME = b"svr04"
OLD_USER = b"phil"
OLD_GECOS = b"Phil California"


def find(root, path):
    node = root
    for part in [p for p in path.split("/") if p]:
        node = next((c for c in node[A_CONTENTS] if c[A_NAME] == part), None)
        if node is None:
            return None
    return node


def rewrite_file(node, replacements):
    data = node[A_CONTENTS]
    for old, new in replacements:
        data = data.replace(old, new)
    node[A_CONTENTS] = data
    node[A_SIZE] = len(data)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("source")
    ap.add_argument("dest")
    ap.add_argument("--hostname", default="web-prod-02")
    ap.add_argument("--user", default="ops", help="replaces the default `phil` account")
    args = ap.parse_args()

    # The input is the pickle shipped in the official Cowrie image, never user data.
    with open(args.source, "rb") as fh:
        root = pickle.load(fh)  # noqa: S301

    host, user = args.hostname.encode(), args.user.encode()

    home = find(root, "/home/" + OLD_USER.decode())
    if home is None or home[A_TYPE] != T_DIR:
        sys.exit("/home/%s not found: unexpected pickle layout" % OLD_USER.decode())
    home[A_NAME] = args.user

    rewrite_file(find(root, "/etc/hostname"), [(OLD_HOSTNAME, host)])
    for path in ("/etc/passwd", "/etc/group", "/etc/shadow"):
        node = find(root, path)
        if node is not None and node[A_TYPE] == T_FILE:
            rewrite_file(node, [(OLD_GECOS, user), (OLD_USER, user)])

    with open(args.dest, "wb") as fh:
        pickle.dump(root, fh, protocol=pickle.HIGHEST_PROTOCOL)
    print("wrote %s (hostname=%s, user=%s)" % (args.dest, args.hostname, args.user))


if __name__ == "__main__":
    main()

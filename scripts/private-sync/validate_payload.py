#!/usr/bin/env python3
"""Validate a decrypted Autumn Compass private-sync ZIP before extraction."""

from __future__ import annotations

import re
import stat
import sys
import zipfile
from pathlib import Path

MAX_EXPANDED_BYTES = 100 * 1024 * 1024
MAX_MEMBERS = 16
WORKSPACE_NAME = re.compile(
    r"^autumn-compass-workspace-\d{4}-\d{2}-\d{2}(?:[_-][A-Za-z0-9_-]+)?\.json$"
)


def is_export_name(name: str) -> bool:
    return name == "autumn-compass-profile.json" or WORKSPACE_NAME.fullmatch(name) is not None


def validate(archive_path: Path) -> None:
    with zipfile.ZipFile(archive_path) as archive:
        members = archive.infolist()
        if not members or len(members) > MAX_MEMBERS:
            raise ValueError("payload has an invalid number of archive members")

        seen: set[str] = set()
        expanded_total = 0
        export_count = 0
        manifest_count = 0

        for member in members:
            name = member.filename
            if not name or "/" in name or "\\" in name or name in {".", ".."}:
                raise ValueError(f"nested or empty archive member rejected: {name!r}")
            if name in seen:
                raise ValueError(f"duplicate archive member rejected: {name}")
            seen.add(name)

            unix_type = (member.external_attr >> 16) & 0o170000
            if member.is_dir() or unix_type not in {0, stat.S_IFREG}:
                raise ValueError(f"non-regular archive member rejected: {name}")

            if name == "SYNC_MANIFEST.txt":
                manifest_count += 1
            elif is_export_name(name):
                export_count += 1
            else:
                raise ValueError(f"unexpected archive member rejected: {name}")

            expanded_total += member.file_size
            if expanded_total > MAX_EXPANDED_BYTES:
                raise ValueError("expanded payload exceeds the 100 MiB safety limit")

        if manifest_count != 1 or export_count < 1:
            raise ValueError("payload must contain one manifest and at least one export")

        corrupt_member = archive.testzip()
        if corrupt_member is not None:
            raise ValueError(f"archive CRC failed for: {corrupt_member}")


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate_payload.py <payload.zip>", file=sys.stderr)
        return 2
    try:
        validate(Path(sys.argv[1]))
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"private-sync payload rejected: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

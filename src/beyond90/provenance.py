"""Where a number came from: a fingerprint of the inputs and the engine that read them.

The customer's files are the system of record. Everything else (scores, plans, reports) is
derived and can be rebuilt. A derived figure is only worth trusting if you can say exactly
which inputs and which engine produced it, so every score carries this record.

The fingerprint ignores differences that cannot change a number: a byte-order mark, and the
choice of line endings (spreadsheet exports differ). It does not ignore anything else, not even
a trailing space, because a file that differs is a different input.

Algorithm (also implemented in site/workspace-core.js; both are tested against each other):
  file hash   = SHA-256 of the file's bytes after removing a leading BOM and turning CRLF and CR into LF
  input hash  = SHA-256 of the UTF-8 text  "<name>\t<file hash>\n"  for each file, sorted by name
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from pathlib import Path

from . import __version__

SCHEMA_VERSION = 1
INPUT_FILES = (
    "customer.toml", "accounts.csv", "inventory.csv", "activations.csv", "findings.csv",
    "teams.csv", "entitlements.csv", "contacts.csv", "commitments.csv",
)


def normalize(raw: bytes) -> bytes:
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    return raw.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def file_hash(raw: bytes) -> str:
    return hashlib.sha256(normalize(raw)).hexdigest()


def input_hash(files: Mapping[str, str]) -> str:
    """Combine per-file hashes (name -> hex) into one."""
    body = "".join(f"{name}\t{files[name]}\n" for name in sorted(files))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def hash_directory(base: str | Path) -> dict[str, str]:
    base = Path(base)
    return {n: file_hash((base / n).read_bytes()) for n in INPUT_FILES if (base / n).is_file()}


def build(files: Mapping[str, str], catalogue_digest: str, ceiling: str, baseline: str, schema_version: int = SCHEMA_VERSION, profile: str = "cnapp") -> dict:
    return {
        "engine": __version__,
        "schema_version": schema_version,
        "input_hash": input_hash(files),
        "files": dict(sorted(files.items())),
        "catalogue": catalogue_digest,
        "profile": profile,
        "ceiling_version": ceiling,
        "baseline_ceiling": baseline,
    }


def describe(p: dict) -> str:
    """One line for the foot of a report."""
    if not p:
        return ""
    return (f"Derived from inputs {p['input_hash'][:12]} ({len(p['files'])} files), catalogue {p.get('profile', 'cnapp')} {p['catalogue'][:8]}, "
            f"ceiling {p['ceiling_version']}, engine {p['engine']}. The same inputs and the same engine give the same numbers.")

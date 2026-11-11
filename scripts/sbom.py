"""Write a CycloneDX 1.5 software bill of materials: this package (no runtime dependencies) and what the browser app bundles.

    python scripts/sbom.py > sbom.cdx.json

The bundled software is read from site/npm/package-lock.json, so versions and integrity hashes come from the lock file
that the build installs from, not from a hand-kept list.
"""
from __future__ import annotations

import json
import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


ROLE = {"pyodide": "Copied into the published site as the in-browser Python runtime",
        "@fontsource-variable/atkinson-hyperlegible-next": "Copied into the published site as its typeface",
        "@fontsource-variable/bricolage-grotesque": "Copied into the published site as its display typeface"}


def build() -> dict:
    meta = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    lock = json.loads((ROOT / "site" / "npm" / "package-lock.json").read_text(encoding="utf-8"))
    manifest = json.loads((ROOT / "site" / "npm" / "package.json").read_text(encoding="utf-8"))
    runtime = set(manifest.get("dependencies", {}))
    components = []
    for path, pkg in sorted(lock.get("packages", {}).items()):
        if not path.startswith("node_modules/"):
            continue
        name = path.removeprefix("node_modules/")
        if name not in runtime:                      # axe-core is a test tool and is not shipped
            continue
        comp = {"type": "library", "name": name, "version": pkg["version"], "purl": f"pkg:npm/{name}@{pkg['version']}",
                "scope": "required", "description": ROLE.get(name, "Copied into the published site")}
        m = re.match(r"sha512-(.+)$", pkg.get("integrity", ""))
        if m:
            import base64
            comp["hashes"] = [{"alg": "SHA-512", "content": base64.b64decode(m.group(1)).hex()}]
        components.append(comp)
    return {
        "bomFormat": "CycloneDX", "specVersion": "1.5", "version": 1,
        "metadata": {"component": {"type": "application", "name": meta["name"], "version": meta["version"], "purl": f"pkg:pypi/{meta['name']}@{meta['version']}",
                                   "licenses": [{"license": {"id": "Apache-2.0"}}], "description": meta["description"]}},
        "components": components,
        "dependencies": [{"ref": f"pkg:pypi/{meta['name']}@{meta['version']}", "dependsOn": [c["purl"] for c in components]}],
    }


if __name__ == "__main__":
    json.dump(build(), sys.stdout, indent=2)
    sys.stdout.write("\n")

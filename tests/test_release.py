"""Things that go wrong at release time: versions that disagree, data files missing from the wheel."""
import importlib.util
import re
import shutil
import subprocess
import sys
import tomllib
import zipfile
from pathlib import Path

import pytest

import beyond90

ROOT = Path(__file__).resolve().parent.parent


def test_every_place_that_states_the_version_agrees():
    py = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["version"]
    assert beyond90.__version__ == py
    top = re.search(r"^## (\d+\.\d+\.\d+)", (ROOT / "CHANGELOG.md").read_text(), re.M)
    assert top and top.group(1) == py, "the newest CHANGELOG heading must be the released version"
    spec = re.search(r"specification v(\d+\.\d+)", (ROOT / "SPEC.md").read_text())
    assert spec and spec.group(1) == ".".join(py.split(".")[:2]), "SPEC.md title must carry the minor version"


def test_the_changelog_has_no_unreleased_leftovers_or_duplicate_versions():
    heads = re.findall(r"^## (.+)$", (ROOT / "CHANGELOG.md").read_text(), re.M)
    assert len(heads) == len(set(heads))
    assert not any("unreleased" in h.lower() for h in heads)


@pytest.mark.skipif(importlib.util.find_spec("pip") is None or importlib.util.find_spec("setuptools") is None,
                    reason="building a wheel offline needs pip and setuptools in this interpreter")
def test_the_wheel_carries_the_data_and_nothing_it_should_not(tmp_path):
    src = tmp_path / "src"
    shutil.copytree(ROOT, src, ignore=shutil.ignore_patterns(".git", "_site", "build", "node_modules", "state", "__pycache__", "*.egg-info", ".venv", ".mypy_cache", ".pytest_cache", ".ruff_cache"))
    out = tmp_path / "dist"
    r = subprocess.run([sys.executable, "-m", "pip", "wheel", "--no-deps", "--no-build-isolation", "-q", "-w", str(out), str(src)],
                       capture_output=True, text=True, timeout=300)
    if r.returncode != 0 and "setuptools" in r.stderr:
        pytest.skip("setuptools is not available offline")
    assert r.returncode == 0, r.stderr[-800:]
    wheel = next(out.glob("beyond90-*.whl"))
    names = set(zipfile.ZipFile(wheel).namelist())
    for needed in ("beyond90/py.typed", "beyond90/data/modules.json", "beyond90/data/resource_types.json", "beyond90/data/playbooks.json",
                   "beyond90/data/rubric.json", "beyond90/data/profiles/endpoint/modules.json", "beyond90/connect/pipeline.py"):
        assert needed in names, needed
    assert not any(n.startswith(("tests/", "site/", "examples/", ".github/")) for n in names)
    assert not any("state/" in n or n.endswith((".db", ".lock")) for n in names)
    meta = next(n for n in names if n.endswith("METADATA"))
    text = zipfile.ZipFile(wheel).read(meta).decode()
    assert "Requires-Dist" not in text.replace("Requires-Dist: pytest", "").replace("Requires-Dist: ruff", "").replace("Requires-Dist: mypy", "") or "extra" in text
    # the installed copy runs from a clean directory, with nothing of the checkout on its path
    target = tmp_path / "site"
    subprocess.run([sys.executable, "-m", "pip", "install", "--no-deps", "-q", "--target", str(target), str(wheel)], check=True, capture_output=True, timeout=300)
    cwd = tmp_path / "elsewhere"
    cwd.mkdir()
    res = subprocess.run([sys.executable, "-I", "-c", "import sys; sys.path.insert(0, sys.argv[1]); import beyond90.cli as c; sys.exit(c.main(['--version']))", str(target)],
                         cwd=cwd, capture_output=True, text=True, timeout=60)
    assert beyond90.__version__ in (res.stdout + res.stderr), res.stderr[-400:]

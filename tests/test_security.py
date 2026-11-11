"""Properties of the project's own security posture that must not quietly regress."""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
WORKFLOWS = sorted((ROOT / ".github" / "workflows").glob("*.yml"))


def csp() -> dict[str, list[str]]:
    html = (SITE / "index.html").read_text(encoding="utf-8")
    m = re.search(r'http-equiv="Content-Security-Policy" content="([^"]+)"', html)
    assert m, "the page has no Content-Security-Policy"
    out = {}
    for part in m.group(1).split(";"):
        bits = part.split()
        if bits:
            out[bits[0]] = bits[1:]
    return out


def test_the_content_security_policy_is_strict():
    p = csp()
    assert p["default-src"] == ["'none'"]
    assert "'unsafe-inline'" not in p["script-src"] and "'unsafe-eval'" not in p["script-src"]
    assert p["script-src"] == ["'self'", "'wasm-unsafe-eval'"]
    assert p["connect-src"] == ["'self'"], "the page must not be able to send data anywhere else"
    assert p["font-src"] == ["'self'"], "the typeface is served with the page, never from a font service"
    assert p["base-uri"] == ["'none'"] and p["form-action"] == ["'none'"]
    assert p["require-trusted-types-for"] == ["'script'"]
    assert set(p["trusted-types"]) == {"b90-report", "b90-worker", "b90-sw"}
    assert not any("*" in v or v.startswith(("http:", "https:")) for vals in p.values() for v in vals), "no wildcard or remote source"


def test_no_script_in_the_site_writes_html_from_strings():
    risky = re.compile(r"\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write\s*\(|\beval\s*\(|new Function\s*\(|setTimeout\s*\(\s*[\"'`]")
    for f in sorted(SITE.glob("*.js")):
        for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            code = line.split("//")[0]
            assert not risky.search(code), f"{f.name}:{n}: {line.strip()}"


def test_every_trusted_types_policy_in_the_code_is_declared_in_the_policy():
    declared = set(csp()["trusted-types"])
    used = set(re.findall(r'createPolicy\("([^"]+)"', "".join(f.read_text(encoding="utf-8") for f in SITE.glob("*.js"))))
    assert used == declared


@pytest.mark.parametrize("wf", WORKFLOWS, ids=lambda p: p.name)
def test_every_workflow_action_is_pinned_to_a_commit(wf):
    for line in wf.read_text(encoding="utf-8").splitlines():
        m = re.search(r"uses:\s*(\S+)", line)
        if m and not m.group(1).startswith("./"):
            assert re.search(r"@[0-9a-f]{40}\b", m.group(1)), f"{wf.name}: {m.group(1)} is not pinned to a commit"


@pytest.mark.parametrize("wf", WORKFLOWS, ids=lambda p: p.name)
def test_workflows_grant_nothing_by_default_and_each_job_only_what_it_needs(wf):
    text = wf.read_text(encoding="utf-8")
    assert re.search(r"^permissions: \{\}$", text, re.M), f"{wf.name}: the token must start with no permissions"
    jobs = re.split(r"^  (?=[a-z][\w-]*:$)", text.split("\njobs:\n", 1)[1], flags=re.M)
    assert all("permissions:" in j for j in jobs if j.strip()), f"{wf.name}: every job declares its permissions"
    assert "pull_request_target" not in text, "pull_request_target runs untrusted code with secrets"


@pytest.mark.parametrize("wf", WORKFLOWS, ids=lambda p: p.name)
def test_checkouts_keep_no_credentials_and_scripts_expand_no_event_data(wf):
    text = wf.read_text(encoding="utf-8")
    assert text.count("actions/checkout@") == text.count("persist-credentials: false"), f"{wf.name}: a checkout keeps the token on disk"
    for block in re.findall(r"run: \|\n((?:\s{10,}.*\n)+)|run: (.*)", text):
        script = "".join(block)
        assert "${{" not in script, f"{wf.name}: a script expands a template; pass it through env instead: {script.strip()[:80]}"


@pytest.mark.parametrize("wf", WORKFLOWS, ids=lambda p: p.name)
def test_python_tools_are_installed_from_hashed_locks(wf):
    for line in wf.read_text(encoding="utf-8").splitlines():
        if "pip install" in line and "--no-deps" not in line.split("&&")[0]:
            assert "--require-hashes -r requirements/" in line, f"{wf.name}: {line.strip()}"


def test_every_lock_file_pins_versions_with_hashes():
    for f in (ROOT / "requirements").glob("*.txt"):
        pkgs = [ln for ln in f.read_text(encoding="utf-8").splitlines() if re.match(r"^[a-z0-9]", ln, re.I)]
        assert pkgs, f"{f.name} is empty"
        assert all("==" in p for p in pkgs), f"{f.name}: every package is pinned"
        assert f.read_text(encoding="utf-8").count("--hash=sha256:") >= len(pkgs), f"{f.name}: every package has a hash"


def test_the_npm_lock_pins_every_package_with_an_integrity_hash():
    lock = json.loads((SITE / "npm" / "package-lock.json").read_text(encoding="utf-8"))
    pkgs = {k: v for k, v in lock["packages"].items() if k}
    assert pkgs
    for name, pkg in pkgs.items():
        assert pkg.get("integrity", "").startswith("sha512-"), name
        assert re.fullmatch(r"\d+\.\d+\.\d+", pkg["version"]), name
    manifest = json.loads((SITE / "npm" / "package.json").read_text(encoding="utf-8"))
    for deps in (manifest["dependencies"], manifest.get("devDependencies", {})):
        assert all(re.fullmatch(r"\d+\.\d+\.\d+", v) for v in deps.values()), "dependencies are pinned to an exact version"


def test_the_sbom_lists_what_the_site_ships_with_hashes():
    import importlib.util
    spec = importlib.util.spec_from_file_location("sbom", ROOT / "scripts" / "sbom.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    bom = mod.build()
    assert bom["bomFormat"] == "CycloneDX" and bom["metadata"]["component"]["name"] == "beyond90"
    names = {c["name"]: c for c in bom["components"]}
    assert set(names) == {"pyodide", "@fontsource-variable/atkinson-hyperlegible-next", "@fontsource-variable/bricolage-grotesque"}, "only what is shipped is listed; test tools are not"
    assert all(len(c["hashes"][0]["content"]) == 128 for c in names.values())


def test_the_package_has_no_runtime_dependencies():
    import tomllib
    meta = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    assert meta["project"]["dependencies"] == []


def test_the_engine_never_opens_a_network_connection_outside_the_connectors():
    """Importing and running the scoring engine must not touch the network; only beyond90.connect may."""
    offenders = []
    for f in (ROOT / "src" / "beyond90").rglob("*.py"):
        if "connect" in f.parts:
            continue
        text = f.read_text(encoding="utf-8")
        if re.search(r"^\s*(import|from)\s+(socket|urllib\.request|http\.client|requests|ssl)\b", text, re.M):
            offenders.append(f.name)
    assert not offenders, f"network imports outside connect/: {offenders}"

"""Two ways to read the same adoption data that customers already think in.

* **Use cases.** A customer did not buy forty switches; they bought outcomes: find misconfigurations, stop
  ransomware, respond faster. Each capability in the catalogue is tagged with the use case it serves, and
  adoption is shown per use case (switched on against switchable). A use case at zero is an expansion
  conversation; one that is half on is an adoption one.
* **Framework functions (NIST CSF 2.0).** Capabilities are also tagged with the CSF function they serve. The
  view shows switched-on capability against capability that applies, per function, and says when it is uneven,
  which is the usual imbalance: strong protection, thin detection and response.

This is *capability adoption mapped to a vocabulary*, not compliance. Govern, and much of Identify, are
organisational work that no product satisfies; they are not measured here. A capability that serves two functions
counts in both.
"""

from __future__ import annotations

from typing import Any

from .catalogue import Catalogue

CSF_FUNCTIONS = ("identify", "protect", "detect", "respond", "recover")
UNEVEN_GAP = 0.25          # difference between the best and worst function that is worth saying out loud


def _state(rate: float, relevant: int) -> str:
    if relevant == 0:
        return "not applicable"
    if rate == 0:
        return "not started"
    if rate < 0.5:
        return "early"
    if rate < 0.9:
        return "partial"
    return "deep"


def adoption_views(score: Any, cat: Catalogue) -> dict[str, Any]:
    l3 = score.stages["L3"]
    modules = (l3.detail or {}).get("modules", {})
    if not l3.has_data or not modules:
        return {}
    by_id = {m.id: m for m in cat.modules}
    uc: dict[str, dict[str, Any]] = {}
    fn: dict[str, dict[str, int]] = {f: {"relevant": 0, "active": 0, "modules": 0} for f in CSF_FUNCTIONS}
    for mid, c in modules.items():
        m = by_id.get(mid)
        if m is None:
            continue
        key = m.use_case or "other"
        u = uc.setdefault(key, {"id": key, "label": cat.use_cases.get(key, key.replace("_", " ").capitalize()), "relevant": 0, "active": 0, "modules": []})
        u["relevant"] += c["relevant"]
        u["active"] += c["active"]
        u["modules"].append({"id": mid, "name": m.name, "relevant": c["relevant"], "active": c["active"], "off": c["relevant"] - c["active"]})
        for f in m.csf:
            if f in fn:
                fn[f]["relevant"] += c["relevant"]
                fn[f]["active"] += c["active"]
                fn[f]["modules"] += 1
    use_cases = []
    for u in uc.values():
        u["rate"] = u["active"] / u["relevant"] if u["relevant"] else 0.0
        u["state"] = _state(u["rate"], u["relevant"])
        u["modules"].sort(key=lambda x: (-x["off"], x["id"]))
        u["biggest_gap"] = u["modules"][0]["name"] if u["modules"] and u["modules"][0]["off"] else ""
        use_cases.append(u)
    use_cases.sort(key=lambda u: (u["rate"], u["id"]))
    functions = {}
    for f, v in fn.items():
        functions[f] = {**v, "rate": (v["active"] / v["relevant"]) if v["relevant"] else None}
    measured = {f: v["rate"] for f, v in functions.items() if v["rate"] is not None}
    note = ""
    if len(measured) >= 2:
        hi, lo = max(measured, key=lambda k: (measured[k], k)), min(measured, key=lambda k: (measured[k], k))
        if measured[hi] - measured[lo] >= UNEVEN_GAP:
            note = (f"Uneven: {hi} is at {measured[hi]:.0%} of the capability that applies and {lo} at {measured[lo]:.0%}. "
                    "A programme is stronger when the functions rise together.")
    return {"use_cases": use_cases, "csf": {"functions": functions, "note": note}}

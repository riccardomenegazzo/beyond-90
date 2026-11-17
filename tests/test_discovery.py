"""Discovery questions: value first, then the customer's weakest stage first."""
from pathlib import Path

from beyond90.catalogue import Catalogue
from beyond90.cli import main
from beyond90.discovery import ordered
from beyond90.loader import load_customer
from beyond90.scoring import compute_score

ROOT = Path(__file__).resolve().parents[1]


def _score(folder):
    d, _ = load_customer(folder)
    cat = Catalogue.for_directory(folder)
    return cat, compute_score(d, cat)


def test_value_questions_open_and_the_weakest_stage_follows():
    cat, sc = _score(ROOT / "examples" / "portfolio" / "northwind")
    qs = ordered(cat, sc)
    stages = [x["stage"] for x in qs]
    first_stage = next(s for s in stages if s != "value")
    weakest = min((k for k, v in sc.stages.items() if v.has_data), key=lambda k: sc.stages[k].value)
    assert stages[0] == "value" and first_stage == weakest
    assert all(x["focus"] == (x["stage"] == weakest) for x in qs)
    assert sorted(x["q"] for x in qs) == sorted(x["q"] for x in cat.discovery)


def test_the_command_prints_a_numbered_list_and_says_when_there_are_none(capsys, tmp_path):
    assert main(["discovery", str(ROOT / "examples" / "profiles" / "hci" / "granite-hci")]) == 0
    out = capsys.readouterr().out
    assert out.startswith("# Questions for Granite Manufacturing") and "\n1. " in out and "\n8. " in out
    # a custom catalogue without discovery.json: the command says so instead of printing nothing
    import shutil
    custom = tmp_path / "catalogue"
    custom.mkdir()
    for name in ("resource_types.json", "modules.json", "playbooks.json"):
        shutil.copy(ROOT / "src" / "beyond90" / "data" / name, custom / name)
    assert main(["discovery", str(ROOT / "examples" / "portfolio" / "northwind"), "--catalogue-dir", str(custom)]) == 1

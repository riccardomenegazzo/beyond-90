"""The outputs committed in docs/example must be what the code produces now."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).parent.parent


def test_committed_example_outputs_are_current(tmp_path):
    spec = importlib.util.spec_from_file_location("generate_outputs", ROOT / "examples" / "generate_outputs.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    fresh = mod.build(tmp_path)
    stale = [name for name, text in fresh.items() if (ROOT / "docs" / "example" / name).read_text(encoding="utf-8") != text]
    assert not stale, f"docs/example is out of date for {stale}: run `python examples/generate_outputs.py` and commit"


def test_output_does_not_depend_on_python_hash_randomization():
    import os
    import subprocess
    import sys

    outputs = set()
    for seed in ("1", "2", "3"):
        env = {**os.environ, "PYTHONHASHSEED": seed, "PYTHONPATH": str(ROOT / "src")}
        run = subprocess.run(
            [sys.executable, "-m", "beyond90", "plan", str(ROOT / "examples" / "portfolio" / "northwind"), "--weeks", "10", "--format", "json"],
            capture_output=True, text=True, env=env, check=True,
        )
        outputs.add(run.stdout)
    assert len(outputs) == 1

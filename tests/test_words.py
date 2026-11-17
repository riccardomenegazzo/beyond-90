from beyond90.words import n_of, plural, verb


def test_counted_nouns_agree():
    assert n_of(1, "finding") == "1 finding" and n_of(0, "finding") == "0 findings"
    assert n_of(3, "entry") == "3 entries" and n_of(2, "day") == "2 days" and n_of(2, "match") == "2 matches"
    assert plural("person") == "people" and verb(1, "is", "are") == "is" and verb(2, "is", "are") == "are"
    assert n_of(2, "team", "teams of people") == "2 teams of people"


def test_no_counted_noun_is_written_with_an_s_in_brackets():
    """'3 finding(s)' reads as a draft. Counts go through words.n_of in the engine and words.js nOf in the page."""
    import re
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    pat = re.compile(r"[\d}] (?:[a-z-]+ ){0,2}[a-z-]+\(s\)|\}\(s\)")
    files = [*root.joinpath("src", "beyond90").glob("*.py"), *root.joinpath("site").glob("*.js")]
    hits = [f"{p.name}:{i}" for p in files for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1) if pat.search(line)]
    assert hits == []

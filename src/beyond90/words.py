"""Counted nouns in plain English: "1 finding", "3 findings", never "finding(s)"."""

from __future__ import annotations

_IRREGULAR = {"person": "people", "this": "these", "is": "are", "was": "were", "has": "have"}


def plural(word: str) -> str:
    if word in _IRREGULAR:
        return _IRREGULAR[word]
    if word.endswith(("s", "x", "ch", "sh")):
        return word + "es"
    if word.endswith("y") and len(word) > 1 and word[-2] not in "aeiou":
        return word[:-1] + "ies"
    return word + "s"


def n_of(n: float, word: str, many: str = "") -> str:
    """The number and the noun, agreed: n_of(1, "finding") is "1 finding", n_of(3, "entry") is "3 entries"."""
    return f"{n:g} {word if n == 1 else (many or plural(word))}" if isinstance(n, float) else f"{n} {word if n == 1 else (many or plural(word))}"


def verb(n: float, one: str, many: str) -> str:
    """The verb that agrees with a count: verb(1, "is", "are")."""
    return one if n == 1 else many

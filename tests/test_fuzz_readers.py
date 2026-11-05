"""Hostile and broken input for every reader that takes outside data: news sources, advisories, and the full browser analysis.

Deterministic (fixed seeds), so a failure reproduces. Set FUZZ_ROUNDS to run longer, e.g. FUZZ_ROUNDS=2000.
"""

import json
import os
import random
from pathlib import Path

import pytest

from beyond90 import feeds
from beyond90.catalogue import Catalogue
from beyond90.radar import parse_threats
from beyond90.web import analyze_files

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "examples" / "portfolio" / "northwind"
FIXTURES = ROOT / "tests" / "fixtures" / "feeds"
ROUNDS = int(os.environ.get("FUZZ_ROUNDS", "150"))
NASTY = ["", "\0", "﻿", "\r\n", '"', '""', ",", ";", "=cmd|' /C calc'!A0", "+1", "-1", "@SUM(1)", "1e309", "-0", "NaN", "inf",
         "9" * 400, "‮", "퟿", "<script>alert(1)</script>", "javascript:alert(1)", "../../etc/passwd", "%00", "${jndi:ldap://x}",
         "🙂" * 50, "\t", " ", "true", "null", "[]", "{}", "2026-02-30", "0000-00-00", "1/1/1", "a" * 10000]


def mutate(text: str, rnd: random.Random) -> str:
    """One of the ways a real file goes wrong, or a hostile one is built."""
    if not text:
        return rnd.choice(NASTY)
    op = rnd.randrange(7)
    i = rnd.randrange(len(text))
    if op == 0:
        return text[:i]                                                  # truncated
    if op == 1:
        return text[:i] + rnd.choice(NASTY) + text[i:]                   # injected
    if op == 2:
        return text[:i] + text[i + rnd.randrange(1, 40):]                # a piece missing
    if op == 3:
        lines = text.splitlines()
        rnd.shuffle(lines)
        return "\n".join(lines)                                          # rows out of order, header moved
    if op == 4:
        b = bytearray(text.encode("utf-8"))
        for _ in range(rnd.randrange(1, 8)):
            b[rnd.randrange(len(b))] = rnd.randrange(256)                # flipped bytes
        return b.decode("utf-8", "replace")
    if op == 5:
        cells = text.split(",")
        for _ in range(rnd.randrange(1, 6)):
            cells[rnd.randrange(len(cells))] = rnd.choice(NASTY)         # hostile values in cells
        return ",".join(cells)
    return text * rnd.randrange(2, 4)                                    # duplicated content


def test_customer_files_never_crash_the_analysis():
    files = {p.name: p.read_text(encoding="utf-8") for p in DEMO.iterdir() if p.suffix in (".csv", ".toml")}
    rnd = random.Random(90)
    for _ in range(max(10, ROUNDS // 5)):                                # a full analysis per round: fewer rounds
        broken = dict(files)
        for name in rnd.sample(sorted(files), rnd.randrange(1, 3)):
            broken[name] = mutate(broken[name], rnd)
        out = analyze_files(broken)
        assert isinstance(out, dict) and isinstance(out.get("ok"), bool)
        if not out["ok"]:
            assert out["errors"] and all(isinstance(e, str) and e for e in out["errors"])
            assert not any("/tmp" in e or "Traceback" in e for e in out["errors"]), out["errors"]


@pytest.mark.parametrize(("parser", "fixture"), [(feeds.parse_xml, "aws.xml"), (feeds.parse_xml, "msrc.xml"), (feeds.parse_xml, "gke.xml"),
                                                 (feeds.parse_jsonfeed, "k8s.json"), (feeds.parse_kev, "kev.json")])
def test_news_sources_answer_with_a_feed_error_or_items(parser, fixture):
    body = (FIXTURES / fixture).read_text(encoding="utf-8")
    rnd = random.Random(fixture)
    for _ in range(ROUNDS):
        try:
            items = parser(mutate(body, rnd).encode("utf-8"))
        except feeds.FeedError:
            continue
        assert isinstance(items, list)
        for it in items:
            assert isinstance(it, dict)
            assert not str(it.get("url", "")).lower().startswith(("javascript:", "data:")), it


@pytest.mark.parametrize("payload", ['<!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;">]><rss>&b;</rss>',
                                     '<?xml version="1.0"?><!DOCTYPE r SYSTEM "file:///etc/passwd"><r/>',
                                     '<rss><channel>' + "<item>" * 5000 + "</channel></rss>",
                                     "<!--" + "x" * 5000 + '--><!DOCTYPE r SYSTEM "http://example.com/x.dtd"><r/>',
                                     '<?xml version="1.0" encoding="UTm-8"?><rss/>'])
def test_hostile_xml_is_refused_without_expanding_anything(payload):
    with pytest.raises(feeds.FeedError):
        feeds.parse_xml(payload.encode())


def test_advisories_answer_with_a_value_error_or_threats():
    cat = Catalogue.for_directory(str(DEMO))
    good = json.loads((ROOT / "examples" / "threats.json").read_text(encoding="utf-8"))
    rnd = random.Random(7)
    shapes = [None, 1, "x", {}, [None], [{}], {"threats": None}, {"threats": [1]}, [{"id": 1}], [{"id": "x", "severity": "nope"}]]
    for s in shapes:
        with pytest.raises(ValueError):
            parse_threats(s, cat)
    for _ in range(ROUNDS):
        text = mutate(json.dumps(good), rnd)
        try:
            raw = json.loads(text)
        except ValueError:
            continue
        try:
            threats = parse_threats(raw, cat, skipped=[])
        except ValueError:
            continue
        for t in threats:
            assert not t.url or t.url.startswith(("https://", "http://"))

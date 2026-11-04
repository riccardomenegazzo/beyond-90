import json
from datetime import date
from pathlib import Path

import pytest

from beyond90 import feeds
from beyond90.catalogue import Catalogue
from beyond90.radar import parse_threats

FIX = Path(__file__).resolve().parent / "fixtures" / "feeds"
CAT = Catalogue.load()
TODAY = date(2026, 11, 2)
BY_HOST = {"kubernetes.io": "k8s.json", "aws.amazon.com": "aws.xml", "docs.cloud.google.com": "gke.xml", "www.cloudvulndb.org": "cvdb.xml",
           "api.msrc.microsoft.com": "msrc.xml", "www.cisa.gov": "kev.json", "api.first.org": "epss.json"}


def fake(calls=None, fail=()):
    def get(url, hosts):
        host = url.split("/")[2]
        assert host in hosts
        if calls is not None:
            calls.append(url)
        if host in fail:
            raise feeds.FeedError("HTTP 503")
        return (FIX / BY_HOST[host]).read_bytes()
    return get


@pytest.fixture(scope="module")
def feed():
    return feeds.collect(cat=CAT, today=TODAY, fetch=fake())


def by_id(feed, sid):
    return next(e for e in feed["threats"] + feed["general"] if e["id"] == sid)


def test_the_default_sources_are_public_https_and_valid():
    srcs = feeds.check_config(feeds.default_config())
    assert {s["id"] for s in srcs} >= {"k8s", "aws", "gke", "kev"}
    assert all(s["url"].startswith("https://") for s in srcs)


def test_one_story_per_cve_across_sources_with_every_source_listed(feed):
    e = by_id(feed, "CVE-2026-90001")
    names = {s["name"] for s in e["sources"]}
    assert {"Kubernetes official CVE feed", "GKE security bulletins", "Known exploited vulnerabilities (CISA)"} <= names
    assert e["kev"] and e["severity"] == "critical" and "KEV" in e["severity_why"] and e["kev_due"] == "2026-11-20"
    assert e["epss"] == 0.93 and e["published"] == "2026-10-28"
    assert "kubernetes" in e["resource_types"] and "container_security" in e["mitigated_by"]
    assert e["providers"] == [] and {"gcp", "kubernetes"} <= set(e["platforms"]), "Kubernetes software concerns clusters on every cloud"
    assert sum(1 for x in feed["threats"] if "CVE-2026-90001" in x["cves"]) == 1
    assert feed["threats"][0]["kev"] and feed["threats"][1]["kev"] and not feed["threats"][2]["kev"], "known exploited comes first"


def test_general_sources_keep_only_what_names_something_cloud(feed):
    ids = {e["id"] for e in feed["threats"] + feed["general"]}
    assert "CVE-2026-90040" not in ids and "CVE-2026-90030" not in ids
    assert "CVE-2026-90031" in ids and "azure" in by_id(feed, "CVE-2026-90031")["providers"]
    assert "CVE-2024-00001" not in ids, "outside the window"


def test_severity_has_a_reason(feed):
    aws = by_id(feed, "CVE-2026-90010")
    assert aws["title"].startswith("IAM role session tags"), "the id is not repeated in the title"
    assert aws["severity"] == "high" and aws["epss"] == 0.61 and "identity" in aws["resource_types"] and aws["providers"] == ["aws"]
    assert by_id(feed, "CVE-2026-90020")["severity"] == "high" and "container escape" in by_id(feed, "CVE-2026-90020")["severity_why"]
    xt = next(e for e in feed["threats"] if e["title"].startswith("Cross-tenant"))
    assert xt["severity"] == "critical" and "managed_database" in xt["resource_types"]
    ai = next(e for e in feed["threats"] if e["title"].startswith("Attack path"))
    assert ai["kind"] == "technique" and "ai_service" in ai["resource_types"] and "ai_posture" in ai["mitigated_by"]
    assert by_id(feed, "CVE-2026-90002")["epss"] is None, "a malformed score is ignored"


def test_text_is_plain_and_links_are_safe(feed):
    aws = by_id(feed, "CVE-2026-90010")
    assert "<" not in aws["summary"] and "alert" not in aws["summary"] and "privilege escalation" in aws["summary"]
    s3 = next(e for e in feed["threats"] if "presigned" in e["title"])
    assert s3["url"] == "" and "storage_object" in s3["resource_types"]
    for e in feed["threats"] + feed["general"]:
        assert e["url"] == "" or e["url"].startswith("https://")
        assert all(s["url"] == "" or s["url"].startswith("https://") for s in e["sources"])


def test_items_without_a_resource_type_are_kept_for_reading(feed):
    g = next(e for e in feed["general"] if e["title"].startswith("Provider changes"))
    assert g["kind"] == "change" and "resource_types" not in g


def test_the_feed_is_read_by_the_engine_as_is(feed):
    threats = parse_threats(json.loads(json.dumps(feed)), CAT, "feed")
    assert len(threats) == len(feed["threats"])
    t = next(x for x in threats if x.id == "CVE-2026-90001")
    assert t.extra["kev"] and t.extra["epss"] == 0.93 and len(t.extra["sources"]) >= 3


def test_a_failing_source_is_reported_and_the_rest_still_count():
    f = feeds.collect(cat=CAT, today=TODAY, fetch=fake(fail={"www.cisa.gov"}))
    st = {s["id"]: s for s in f["sources"]}
    assert not st["kev"]["ok"] and st["kev"]["error"] == "HTTP 503" and st["k8s"]["ok"]
    e = by_id(f, "CVE-2026-90001")
    assert not e["kev"] and e["severity"] == "critical" and "EPSS" in e["severity_why"]


def test_epss_is_asked_in_batches_of_at_most_100():
    calls = []
    feeds.collect(cat=CAT, today=TODAY, fetch=fake(calls))
    epss = [c for c in calls if "api.first.org" in c]
    assert len(epss) == 1 and all(c.count("CVE-") <= 100 for c in epss)


def test_first_seen_carries_over_from_the_previous_feed(feed):
    prev = {"threats": [{"id": "CVE-2026-90001", "first_seen": "2026-10-28"}, {"id": "x", "first_seen": "nonsense"}]}
    f = feeds.collect(cat=CAT, today=TODAY, fetch=fake(), previous=prev)
    assert by_id(f, "CVE-2026-90001")["first_seen"] == "2026-10-28"
    assert by_id(f, "CVE-2026-90010")["first_seen"] == TODAY.isoformat()


def test_xml_with_entities_is_refused_before_parsing():
    with pytest.raises(feeds.FeedError, match="DOCTYPE"):
        feeds.parse_xml((FIX / "doctype.xml").read_bytes())
    with pytest.raises(feeds.FeedError):
        feeds.parse_xml(b"<rss><channel><item><title>x</title></item>")


def test_configuration_errors_name_the_source():
    with pytest.raises(ValueError, match=r"source #1.*https"):
        feeds.check_config({"sources": [{"id": "a", "url": "http://x.example", "kind": "xml"}]})
    with pytest.raises(ValueError, match="kind"):
        feeds.check_config({"sources": [{"id": "a", "url": "https://x.example", "kind": "html"}]})
    with pytest.raises(ValueError, match="duplicate"):
        feeds.check_config({"sources": [{"id": "a", "url": "https://x.example", "kind": "xml"}] * 2})


def test_redirects_leave_only_to_configured_https_hosts():
    from beyond90.connect.newsfetch import _Redirects
    h = _Redirects(["a.example"])
    with pytest.raises(feeds.FeedError):
        h.redirect_request(None, None, 302, "", {}, "https://evil.example/x")
    with pytest.raises(feeds.FeedError):
        h.redirect_request(None, None, 302, "", {}, "http://a.example/x")
    with pytest.raises(feeds.FeedError, match="configured host"):
        feeds.http_get("https://evil.example/feed", ["a.example"])


def test_plain_text_drops_markup_and_controls():
    assert feeds.plain("<p>a<script>x()</script> <b>b</b>‮</p>&amp; c") == "a b & c"
    assert feeds.plain("word " * 100, 20).endswith("…") and len(feeds.plain("word " * 100, 20)) <= 21


def test_markdown_summary_lists_sources_and_stories(feed):
    md = feeds.render_markdown(feed)
    assert "KEV" in md and "Kubernetes official CVE feed" in md and "Also worth reading" in md


# ----------------------------------------------------------------------------- where the news lands
ROOT = Path(__file__).resolve().parent.parent
PORTFOLIO = ROOT / "examples" / "portfolio"


def _groups():
    return {d.name: {p.name: p.read_text() for p in d.iterdir() if p.suffix in (".csv", ".toml")} for d in sorted(PORTFOLIO.iterdir()) if d.is_dir()}


def test_the_book_lists_each_story_with_the_customers_it_touches(feed):
    from beyond90.web import analyze_book
    b = analyze_book(_groups(), advisories=json.loads(json.dumps(feed)), week_hours=30)
    assert b["ok"] and b["news"]
    top = b["news"][0]
    assert top["kev"] and top["customers"]
    assert all({"key", "name", "exposed", "uncovered", "unknown"} <= set(c) for c in top["customers"])
    flags = [(not e.get("kev"), -e["uncovered_customers"]) for e in b["news"]]
    assert flags[0] <= min(flags)


def test_the_customer_briefing_is_ready_to_send_and_has_no_internal_scores(feed):
    from beyond90.web import analyze
    r = analyze(str(PORTFOLIO / "northwind"), advisories=json.loads(json.dumps(feed)))
    md = r["briefing_markdown"]
    assert md.startswith("# Cloud security briefing for") and "known to be exploited" in md
    assert "Yield" not in md and " pts" not in md and "L4" not in md
    assert "Read more: [" in md
    exp = r["dashboard"]["rhythm"]["exposures"]
    assert exp[0].get("kev") is not None or any(e.get("kev") for e in exp)
    assert analyze(str(PORTFOLIO / "northwind"))["briefing_markdown"] == ""


def test_exploited_news_on_uncovered_accounts_alerts_once():
    from types import SimpleNamespace

    from beyond90.alerts import compute_alerts, news_to_alert
    score = SimpleNamespace(rubric={}, yield_=0.5, quality={}, terms={"units": "accounts"})
    e = {"id": "CVE-2026-1", "title": "x", "severity": "high", "kev": True, "uncovered": 2}
    quiet = {"id": "CVE-2026-2", "title": "y", "severity": "high", "uncovered": 3}
    covered = {"id": "CVE-2026-3", "title": "z", "severity": "critical", "uncovered": 0}
    assert news_to_alert([e, quiet, covered]) == [e]
    first = compute_alerts(score=score, metrics={}, previous=None, sync_problems=[], drift=None, renewal=None, exposures=[e, quiet, covered])
    assert [a["key"] for a in first] == ["news:CVE-2026-1"] and "known to be exploited" in first[0]["text"]
    again = compute_alerts(score=score, metrics={}, previous={"news_alerted": ["CVE-2026-1"]}, sync_problems=[], drift=None, renewal=None, exposures=[e])
    assert not again


def test_the_cli_writes_the_feed_and_refuses_to_overwrite_when_nothing_was_read(tmp_path, monkeypatch, capsys):
    from beyond90 import cli
    monkeypatch.setattr(feeds, "http_get", fake())
    out = tmp_path / "feed.json"
    assert cli.main(["feeds", "--out", str(out), "--days", "60"]) == 0
    doc = json.loads(out.read_text())
    assert doc["schema"] == "beyond90-feed/1" and doc["window_days"] == 60 and doc["threats"]
    monkeypatch.setattr(feeds, "http_get", fake(fail=set(BY_HOST)))
    stale = tmp_path / "keep.json"
    stale.write_text("{}")
    assert cli.main(["feeds", "--out", str(stale)]) == 1 and stale.read_text() == "{}"
    assert "nothing written" in capsys.readouterr().err


def test_the_exploited_catalogue_keeps_cloud_workload_software_and_says_what_it_dropped(feed):
    k = by_id(feed, "CVE-2026-90050")
    assert k["kev"] and "compute" in k["resource_types"] and k["providers"] == []
    st = next(s for s in feed["sources"] if s["id"] == "kev")
    assert st["dropped"]["not_cloud"] == 1 and st["dropped"]["old"] == 1 and st["newest"] == "2026-10-31"
    assert next(s for s in feed["sources"] if s["id"] == "k8s")["dropped"]["old"] == 1


def test_the_cap_applies_after_the_cloud_filter(monkeypatch):
    """A general source with many newer non-cloud items must not crowd out its older cloud ones."""
    items = "".join(f"<item><title>Desktop component issue {i} (mock)</title><pubDate>Sat, 31 Oct 2026 0{i % 10}:00:00 GMT</pubDate></item>" for i in range(30))
    items += "<item><title>Azure Kubernetes Service node escape (mock)</title><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate></item>"
    body = f"<rss><channel>{items}</channel></rss>".encode()
    monkeypatch.setattr(feeds, "PER_SOURCE", 5)
    cfg = {"sources": [{"id": "g", "name": "General", "url": "https://g.example/rss", "kind": "xml"}], "epss": ""}
    f = feeds.collect(cfg, cat=CAT, today=TODAY, fetch=lambda url, hosts: body)
    assert [e["title"] for e in f["threats"]] == ["Azure Kubernetes Service node escape (mock)"]
    st = f["sources"][0]
    assert st["kept"] == 1 and st["dropped"]["not_cloud"] == 30 and st["dropped"]["over_cap"] == 0


def test_the_exploited_catalogue_leaves_out_network_appliances():
    kev = {"vulnerabilities": [
        {"cveID": "CVE-2026-91001", "vendorProject": "Acme", "product": "Secure Firewall", "vulnerabilityName": "Firewall VPN gateway authentication bypass (mock)", "dateAdded": "2026-10-30"},
        {"cveID": "CVE-2026-91002", "vendorProject": "Linux", "product": "Kernel", "vulnerabilityName": "Linux kernel race condition (mock)", "dateAdded": "2026-10-30"},
        {"cveID": "CVE-2026-91003", "vendorProject": "Acme", "product": "Docs Server", "vulnerabilityName": "Path traversal while rendering images (mock)", "dateAdded": "2026-10-30"}]}
    cfg = {"sources": [s for s in feeds.default_config()["sources"] if s["id"] == "kev"], "epss": ""}
    f = feeds.collect(cfg, cat=CAT, today=TODAY, fetch=lambda url, hosts: json.dumps(kev).encode())
    assert [e["id"] for e in f["threats"]] == ["CVE-2026-91002"]

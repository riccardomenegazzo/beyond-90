"""Cloud security news, read every day and matched to each customer.

A TAM is useful between reviews when the customer hears about a new cloud vulnerability from them first, with the
answer to the only question that matters: does it touch us? This module reads public sources (provider bulletins,
the Kubernetes CVE feed, community cloud vulnerability databases, the catalogue of vulnerabilities known to be
exploited, and any RSS, Atom or JSON Feed you add, such as the blogs of security researchers) and turns them into
advisories in the format the rest of the engine already matches against inventories:

* **Read safely.** https only, the host of every redirect must be a configured source, a size cap and a timeout per
  source, XML with a DOCTYPE or an entity declaration refused before parsing, HTML reduced to plain text, links kept
  only if they are http(s). A source that fails is reported and the others still count.
* **Cloud only.** Each item is tied to providers and resource types by whole-word terms (``data/cloud_terms.json``).
  Sources that are cloud by nature keep every item; general sources keep only items that name a provider, or, when
  the source says ``"keep": "provider_or_type"`` (the exploited catalogue), a cloud resource type such as compute.
* **One story, several sources.** Items that share a CVE (or a link) are merged: the story lists every source.
* **Prioritised for a reason.** Known exploited (KEV) is critical; an exploit probability (EPSS) of 0.5 or more
  is at least high and 0.9 or more critical; otherwise words in the text. Every severity carries the sentence that explains it.
* **First seen.** With the previous feed, each story keeps the date it first appeared, so "new this week" is exact.

Nothing here is a judgement about a vendor: the sources are configuration, and the defaults are public.
"""

from __future__ import annotations

import hashlib
import json
import re
import xml.etree.ElementTree as ET
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from email.utils import parsedate_to_datetime
from html import unescape
from html.parser import HTMLParser
from importlib import resources
from typing import Any, Optional
from urllib.parse import urlparse

from .catalogue import Catalogue

MAX_BYTES = 16 * 1024 * 1024
TIMEOUT = 25.0
PER_SOURCE = 300
PARSE_CAP = 20000
TOTAL = 400
CVE = re.compile(r"\bCVE-\d{4}-\d{4,7}\b", re.I)
KINDS = ("jsonfeed", "xml", "kev")
SEV_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}

Fetcher = Callable[[str, list[str]], bytes]


class FeedError(Exception):
    pass


# ------------------------------------------------------------------ configuration

def default_config() -> dict[str, Any]:
    return dict(json.loads(resources.files("beyond90.data").joinpath("feeds.json").read_text(encoding="utf-8")))


def terms() -> dict[str, Any]:
    return dict(json.loads(resources.files("beyond90.data").joinpath("cloud_terms.json").read_text(encoding="utf-8")))


def check_config(cfg: dict[str, Any]) -> list[dict[str, Any]]:
    """The sources, validated. Errors name the source and the field."""
    srcs = cfg.get("sources")
    if not isinstance(srcs, list) or not srcs:
        raise ValueError("feeds: 'sources' must be a non-empty list")
    out, seen, errors = [], set(), []
    for i, s in enumerate(srcs, start=1):
        sid = str(s.get("id", "")).strip() if isinstance(s, dict) else ""
        where = f"source #{i} ({sid or 'no id'})"
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,31}", sid):
            errors.append(f"{where}: id must be 1-32 lowercase letters, digits, '-' or '_'")
        elif sid in seen:
            errors.append(f"{where}: duplicate id")
        seen.add(sid)
        url = str(s.get("url", "")) if isinstance(s, dict) else ""
        if urlparse(url).scheme != "https" or not urlparse(url).hostname:
            errors.append(f"{where}: url must be https")
        kind = s.get("kind") if isinstance(s, dict) else None
        if kind not in KINDS:
            errors.append(f"{where}: kind must be one of {', '.join(KINDS)}")
        if errors:
            continue
        out.append({"id": sid, "name": str(s.get("name") or sid)[:80], "url": url, "kind": kind, "cloud": bool(s.get("cloud", False)),
                    "providers": [str(p).lower() for p in s.get("providers", [])], "types": [str(t) for t in s.get("types", [])],
                    "keep": "provider_or_type" if s.get("keep") == "provider_or_type" else "provider",
                    "keep_types": [str(t) for t in s.get("keep_types", [])]})
    if errors:
        raise ValueError("invalid feed sources:\n  " + "\n  ".join(errors))
    return out


# ------------------------------------------------------------------ fetching

def http_get(url: str, hosts: list[str]) -> bytes:
    """GET over https with a size cap; redirects only to hosts in ``hosts``. The network code lives in ``connect``, like all of it."""
    from .connect.newsfetch import http_get as get
    return get(url, hosts)


# ------------------------------------------------------------------ text

class _Text(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag in ("script", "style", "template"):
            self.skip += 1
        elif tag in ("p", "br", "li", "div", "tr", "h1", "h2", "h3", "h4"):
            self.parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "template") and self.skip:
            self.skip -= 1

    def handle_data(self, data: str) -> None:
        if not self.skip:
            self.parts.append(data)


def plain(s: Any, limit: int = 0) -> str:
    """HTML or text to one line of plain text, without control characters; cut at a word when ``limit`` is set."""
    raw = str(s or "")
    if "<" in raw:
        p = _Text()
        try:
            p.feed(raw)
            p.close()
            raw = "".join(p.parts)
        except Exception:
            raw = re.sub(r"<[^>]*>", " ", raw)
    t = re.sub(r"[\x00-\x1f\x7f​-‏‪-‮⁦-⁩]", " ", unescape(raw))
    t = re.sub(r"\s+", " ", t).strip()
    if limit and len(t) > limit:
        t = t[:limit].rsplit(" ", 1)[0].rstrip(",.;:") + "…"
    return t


def safe_link(u: Any) -> str:
    s = str(u or "").strip()
    return s if re.fullmatch(r"https?://[^\s<>\"'`]{1,2000}", s) else ""


def _date(s: Any) -> Optional[date]:
    v = str(s or "").strip()
    if not v:
        return None
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00")).date()
    except ValueError:
        pass
    try:
        return parsedate_to_datetime(v).date()
    except (TypeError, ValueError, IndexError):
        pass
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", v)
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None
    except ValueError:
        return None


# ------------------------------------------------------------------ parsing

def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _child(el: ET.Element, *names: str) -> Optional[ET.Element]:
    for c in el:
        if _local(c.tag) in names:
            return c
    return None


def _text(el: Optional[ET.Element]) -> str:
    return "".join(el.itertext()) if el is not None else ""


def parse_xml(body: bytes) -> list[dict[str, Any]]:
    """RSS 2.0 or Atom. A document that declares a DOCTYPE or an entity is refused before it is parsed."""
    head = body[:4096].lower()
    if b"<!doctype" in head or b"<!entity" in body.lower():
        raise FeedError("XML with a DOCTYPE or an entity declaration is refused")
    try:
        root = ET.fromstring(body)
    except ET.ParseError as e:
        raise FeedError(f"not valid XML ({e})") from None
    items = [el for el in root.iter() if _local(el.tag) in ("item", "entry")]
    out = []
    for it in items[:PARSE_CAP]:
        link = ""
        for c in it:
            if _local(c.tag) == "link":
                href = c.get("href")
                if href and c.get("rel", "alternate") == "alternate":
                    link = href
                    break
                inner = (c.text or "").strip()
                if not href and inner:
                    link = inner
                    break
        when = _text(_child(it, "pubdate", "published", "updated", "date", "issued"))
        body_text = _text(_child(it, "description", "summary", "encoded", "content"))
        out.append({"title": _text(_child(it, "title")), "url": link or _text(_child(it, "guid", "id")), "published": when, "text": body_text,
                    "guid": _text(_child(it, "guid", "id"))})
    return out


def parse_jsonfeed(body: bytes) -> list[dict[str, Any]]:
    try:
        doc = json.loads(body.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise FeedError("not valid JSON") from None
    items = doc.get("items") if isinstance(doc, dict) else None
    if not isinstance(items, list):
        raise FeedError("a JSON Feed has an 'items' list")
    out = []
    for it in items[:PARSE_CAP]:
        if not isinstance(it, dict):
            continue
        out.append({"title": it.get("title") or it.get("id") or "", "url": it.get("url") or it.get("external_url") or "",
                    "published": it.get("date_published") or it.get("date_modified") or "", "text": it.get("content_text") or it.get("summary") or it.get("content_html") or "",
                    "guid": str(it.get("id") or "")})
    return out


def parse_kev(body: bytes) -> list[dict[str, Any]]:
    try:
        doc = json.loads(body.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise FeedError("not valid JSON") from None
    vulns = doc.get("vulnerabilities") if isinstance(doc, dict) else None
    if not isinstance(vulns, list):
        raise FeedError("the catalogue has a 'vulnerabilities' list")
    out = []
    for v in vulns:
        if not isinstance(v, dict) or not CVE.fullmatch(str(v.get("cveID", ""))):
            continue
        cve = str(v["cveID"]).upper()
        out.append({"title": f"{v.get('vulnerabilityName') or cve}", "url": f"https://www.cve.org/CVERecord?id={cve}", "published": v.get("dateAdded", ""),
                    "text": f"{v.get('vendorProject', '')} {v.get('product', '')}. {v.get('shortDescription', '')} Required action: {v.get('requiredAction', '')}",
                    "guid": cve, "kev": True, "kev_due": str(v.get("dueDate", ""))[:10], "ransomware": str(v.get("knownRansomwareCampaignUse", "")).lower() == "known",
                    "product": f"{v.get('vendorProject', '')} {v.get('product', '')}".strip()})
    return out


PARSERS: dict[str, Callable[[bytes], list[dict[str, Any]]]] = {"xml": parse_xml, "jsonfeed": parse_jsonfeed, "kev": parse_kev}


# ------------------------------------------------------------------ classification

def _compile(words: list[str]) -> re.Pattern[str]:
    return re.compile(r"(?<![\w-])(?:" + "|".join(re.escape(w) for w in sorted(words, key=len, reverse=True)) + r")(?![\w-])", re.I)


class Classifier:
    def __init__(self, t: Optional[dict[str, Any]] = None) -> None:
        t = t or terms()
        self.providers = {k: _compile(v) for k, v in t["providers"].items()}
        self.types = {k: _compile(v) for k, v in t["types"].items()}
        self.kinds = {k: _compile(v) for k, v in t["kinds"].items()}
        self.severity = {k: _compile(v) for k, v in t["severity"].items()}

    def classify(self, text: str) -> dict[str, Any]:
        found = lambda table: sorted(k for k, rx in table.items() if rx.search(text))  # noqa: E731
        kinds = found(self.kinds)
        sev, why = "medium", "no stronger signal in the text"
        for level in ("critical", "high", "low"):
            m = self.severity[level].search(text)
            if m:
                sev, why = level, f"the text says “{m.group(0).lower()}”"
                break
        return {"providers": found(self.providers), "types": found(self.types), "kinds": kinds, "severity": sev, "severity_why": why}


def _mitigations(types: list[str], kinds: list[str], has_cve: bool, cat: Catalogue) -> list[str]:
    known = {m.id: m for m in cat.modules}
    out = [m.id for m in cat.modules if set(m.requires_any) & set(types)]
    if "technique" in kinds or "change" in kinds or not has_cve:
        out.append("posture")
    if ("incident" in kinds or "exploited" in kinds or "technique" in kinds) and "cloud_detection" in known:
        out.append("cloud_detection")
    if has_cve and set(types) & {"compute", "container_registry", "serverless"} and "vulnerability_scanning" in known:
        out.insert(0, "vulnerability_scanning")
    seen: list[str] = []
    for m in out:
        if m in known and m not in seen:
            seen.append(m)
    return seen or ([k for k in ("posture",) if k in known])


# ------------------------------------------------------------------ the run

def _story_id(cves: list[str], url: str, title: str) -> str:
    if cves:
        return cves[0]
    return "NEWS-" + hashlib.sha256((url or title).encode("utf-8")).hexdigest()[:10]


def collect(cfg: Optional[dict[str, Any]] = None, *, cat: Catalogue, today: Optional[date] = None, previous: Any = None,
            fetch: Optional[Fetcher] = None) -> dict[str, Any]:
    """Read every source, keep what is cloud and recent, merge stories, enrich and rank. Never raises for a bad source."""
    cfg = cfg or default_config()
    sources = check_config(cfg)
    today = today or datetime.now(UTC).date()
    window = int(cfg.get("window_days", 60))
    since = today - timedelta(days=max(1, min(window, 365)))
    hosts = sorted({urlparse(s["url"]).hostname or "" for s in sources} | {urlparse(str(cfg.get("epss", ""))).hostname or ""} - {""})
    get = fetch or http_get
    clf = Classifier()
    report, raw = [], []
    for s in sources:
        st: dict[str, Any] = {"id": s["id"], "name": s["name"], "url": s["url"], "ok": False, "read": 0, "kept": 0, "error": "",
                              "dropped": {"undated": 0, "old": 0, "not_cloud": 0, "over_cap": 0}, "newest": ""}
        try:
            items = PARSERS[s["kind"]](get(s["url"], hosts))
            st["ok"], st["read"] = True, len(items)
        except FeedError as e:
            st["error"] = str(e)[:200]
            report.append(st)
            continue
        dated = []
        for it in items:
            pub = _date(it.get("published"))
            if pub is None:
                st["dropped"]["undated"] += 1
                continue
            st["newest"] = max(st["newest"], pub.isoformat())
            if pub < since or pub > today + timedelta(days=1):
                st["dropped"]["old"] += 1
                continue
            dated.append((pub, it))
        kept: list[dict[str, Any]] = []
        for pub, it in dated:
            title = plain(it.get("title"), 240)
            text = plain(it.get("text"))
            if not title:
                st["dropped"]["undated"] += 1
                continue
            blob = f"{title} {text} {it.get('product', '')}"
            c = clf.classify(blob)
            providers = sorted(set(c["providers"]) | set(s["providers"]))
            # Matching narrows to a provider only when the item is about that provider's service. Kubernetes software runs on
            # every cloud, so a Kubernetes advisory read in one provider's bulletin still concerns every cluster.
            match = sorted((set(c["providers"]) or set(s["providers"])) - {"kubernetes"})
            types = sorted(set(c["types"]) | set(s["types"]))
            by_type = s["keep"] == "provider_or_type" and (set(types) & set(s["keep_types"]) if s["keep_types"] else types)
            if not s["cloud"] and not providers and not by_type:
                st["dropped"]["not_cloud"] += 1
                continue                                            # a general source: only what names something cloud
            cves = sorted({x.upper() for x in CVE.findall(f"{it.get('guid', '')} {title} {text}")})[:20]
            kept.append({"title": title, "url": safe_link(it.get("url")), "published": pub, "summary": plain(it.get("text"), 320),
                         "cves": cves, "providers": providers, "match": match, "types": types, "kinds": c["kinds"], "severity": c["severity"], "severity_why": c["severity_why"],
                         "kev": bool(it.get("kev")), "kev_due": it.get("kev_due", ""), "ransomware": bool(it.get("ransomware")), "source": s["name"], "source_id": s["id"]})
        kept.sort(key=lambda r: r["published"], reverse=True)       # feeds differ in order; the cap keeps the newest cloud items
        st["dropped"]["over_cap"] = max(0, len(kept) - PER_SOURCE)
        raw.extend(kept[:PER_SOURCE])
        st["kept"] = min(len(kept), PER_SOURCE)
        report.append(st)

    stories = _merge(raw)
    _enrich_epss(stories, str(cfg.get("epss") or ""), hosts, get, report)
    first = _first_seen(previous)
    threats, general = [], []
    for st_ in stories:
        sev, why = st_["severity"], st_["severity_why"]
        if st_["kev"]:
            sev, why = "critical", "known to be exploited (KEV)" + (", used in ransomware campaigns" if st_["ransomware"] else "")
        elif st_.get("epss") is not None and st_["epss"] >= 0.9 and sev != "critical":
            sev, why = "critical", f"exploit probability (EPSS) {st_['epss']:.0%} in the next 30 days"
        elif st_.get("epss") is not None and st_["epss"] >= 0.5 and SEV_ORDER[sev] > SEV_ORDER["high"]:
            sev, why = "high", f"exploit probability (EPSS) {st_['epss']:.0%} in the next 30 days"
        elif "exploited" in st_["kinds"] and SEV_ORDER[sev] > SEV_ORDER["high"]:
            sev, why = "high", "reported as exploited"
        sid = _story_id(st_["cves"], st_["url"], st_["title"])
        kind = next((k for k in ("exploited", "incident", "technique", "change") if k in st_["kinds"]), "vulnerability" if st_["cves"] else "advisory")
        title = re.sub(rf"^{re.escape(sid)}\s*[-:\u2013\u2014]\s*", "", st_["title"], flags=re.I) or st_["title"]   # the id is shown next to it
        entry = {"id": sid, "title": title, "severity": sev, "severity_why": why, "published": st_["published"].isoformat(),
                 "first_seen": first.get(sid, today.isoformat()), "providers": st_["match"], "platforms": st_["providers"], "kind": kind,
                 "summary": st_["summary"], "url": st_["url"], "source": ", ".join(x["name"] for x in st_["sources"])[:120], "sources": st_["sources"][:8],
                 "cves": st_["cves"], "kev": st_["kev"], "kev_due": st_["kev_due"], "ransomware": st_["ransomware"], "epss": st_.get("epss")}
        if st_["types"]:
            entry["resource_types"] = [t for t in st_["types"] if t in cat.resource_types]
        if entry.get("resource_types"):
            entry["mitigated_by"] = _mitigations(entry["resource_types"], st_["kinds"], bool(st_["cves"]), cat)
            threats.append(entry)
        else:
            general.append(entry)
    rank = lambda e: (not e["kev"], SEV_ORDER[e["severity"]], -date.fromisoformat(e["published"]).toordinal(), -(e["epss"] or 0), e["id"])  # noqa: E731
    threats.sort(key=rank)
    general.sort(key=rank)
    return {"schema": "beyond90-feed/1", "generated": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "as_of": today.isoformat(), "window_days": window, "sources": report,
            "note": "Collected by `beyond90 feeds` from public sources. Matching is by resource type and provider; read the source before acting.",
            "threats": threats[:TOTAL], "general": general[:TOTAL // 2]}


def _merge(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Union of items that share a CVE or a link."""
    parent = list(range(len(raw)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    keys: dict[str, int] = {}
    for i, r in enumerate(raw):
        title_key = re.sub(r"\W+", " ", r["title"].lower()).strip()
        for k in [*r["cves"], r["url"].rstrip("/").lower() if r["url"] else "", title_key if len(title_key) >= 24 else ""]:
            if not k:
                continue
            if k in keys:
                parent[find(i)] = find(keys[k])
            else:
                keys[k] = i
    groups: dict[int, list[dict[str, Any]]] = {}
    for i, r in enumerate(raw):
        groups.setdefault(find(i), []).append(r)
    out = []
    for g in groups.values():
        lead = next((r for r in g if not r["kev"]), g[0])          # a bulletin or an article reads better than a catalogue line
        srcs: list[dict[str, str]] = []
        for r in g:
            if not any(x["name"] == r["source"] for x in srcs):
                srcs.append({"name": r["source"], "url": r["url"]})
        out.append({"title": lead["title"], "url": lead["url"] or next((r["url"] for r in g if r["url"]), ""), "published": min(r["published"] for r in g),
                    "summary": lead["summary"] or next((r["summary"] for r in g if r["summary"]), ""),
                    "cves": sorted({c for r in g for c in r["cves"]})[:20], "providers": sorted({p for r in g for p in r["providers"]}),
                    "match": [] if any(not r["match"] for r in g) else sorted({p for r in g for p in r["match"]}),
                    "types": sorted({t for r in g for t in r["types"]}), "kinds": sorted({k for r in g for k in r["kinds"]}),
                    "severity": min((r["severity"] for r in g), key=SEV_ORDER.__getitem__),
                    "severity_why": min(g, key=lambda r: SEV_ORDER[r["severity"]])["severity_why"],
                    "kev": any(r["kev"] for r in g), "kev_due": next((r["kev_due"] for r in g if r["kev_due"]), ""),
                    "ransomware": any(r["ransomware"] for r in g), "sources": srcs})
    return out


def _enrich_epss(stories: list[dict[str, Any]], url: str, hosts: list[str], get: Fetcher, report: list[dict[str, Any]]) -> None:
    cves = sorted({c for s in stories for c in s["cves"]})
    if not url or not cves:
        return
    scores: dict[str, float] = {}
    st: dict[str, Any] = {"id": "epss", "name": "Exploit prediction (EPSS)", "url": url, "ok": True, "read": 0, "kept": 0, "error": ""}
    for i in range(0, len(cves), 100):
        try:
            doc = json.loads(get(f"{url}?cve={','.join(cves[i:i + 100])}", hosts).decode("utf-8"))
            for row in doc.get("data", []) if isinstance(doc, dict) else []:
                c, v = str(row.get("cve", "")).upper(), float(row.get("epss", "nan"))
                if CVE.fullmatch(c) and 0.0 <= v <= 1.0:
                    scores[c] = v
        except (FeedError, ValueError, TypeError, AttributeError) as e:
            st["ok"], st["error"] = False, str(e)[:200] or type(e).__name__
            break
    st["read"] = st["kept"] = len(scores)
    report.append(st)
    for s in stories:
        vals = [scores[c] for c in s["cves"] if c in scores]
        s["epss"] = round(max(vals), 4) if vals else None


def _first_seen(previous: Any) -> dict[str, str]:
    out: dict[str, str] = {}
    if isinstance(previous, dict):
        for e in [*previous.get("threats", []), *previous.get("general", [])]:
            if isinstance(e, dict) and isinstance(e.get("id"), str) and _date(e.get("first_seen")):
                out[e["id"]] = str(e["first_seen"])[:10]
    return out


# ------------------------------------------------------------------ reading it back

def render_markdown(feed: dict[str, Any], limit: int = 25) -> str:
    L = [f"# Cloud security news, {feed['as_of']}", "", f"Last {feed['window_days']} days. Sources:"]
    for s in feed["sources"]:
        L.append(f"- {s['name']}: " + (f"{s['kept']} kept of {s['read']}" if s["ok"] else f"not read ({s['error']})"))
    L += ["", "## Matched to resource types", ""]
    for e in feed["threats"][:limit]:
        tag = " **KEV**" if e["kev"] else ""
        L.append(f"- **{e['severity']}**{tag} {e['published']} {e['title']} ({', '.join(e['resource_types'])}; {e['severity_why']}). {e['source']}" + (f" <{e['url']}>" if e["url"] else ""))
    if feed["general"]:
        L += ["", "## Also worth reading", ""] + [f"- {e['published']} {e['title']}. {e['source']}" + (f" <{e['url']}>" if e["url"] else "") for e in feed["general"][:limit]]
    return "\n".join(L) + "\n"

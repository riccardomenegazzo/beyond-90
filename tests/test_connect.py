import json
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest

from beyond90.connect import ConfigError, FetchError, MapError, SyncError, fetch_source, load_config, map_records, sync
from beyond90.connect.mapping import get_path
from beyond90.loader import load_customer
from connect_helpers import TENANTS, Api, config_text, paged, serve_default

ROOT = Path(__file__).resolve().parent.parent
NOW = datetime(2026, 11, 2, 6, 0, tzinfo=UTC)
AS_OF = date(2026, 11, 2)
ENV = {"T_TOKEN": "t0ken", "PATH": "/usr/bin:/bin"}


@pytest.fixture
def api():
    a = Api()
    serve_default(a)
    yield a
    a.stop()


def cfg_for(tmp_path, text):
    p = tmp_path / "beyond90.toml"
    p.write_text(text)
    return load_config(p)


# ---------------------------------------------------------------------------- mapping

def test_paths_read_nested_values_lists_and_missing_things():
    doc = {"a": {"b": [{"c": 1}, {"c": 2}]}, "s": "x"}
    assert get_path(doc, "a.b.1.c") == 2 and get_path(doc, "a.b.5.c") is None and get_path(doc, "s.t") is None and get_path(doc, "zzz") is None


def test_every_transform_and_the_map_with_default():
    rows, empty = map_records(
        [{"s": "Hello", "b": "Yes", "d": "2026-10-31T10:00:00Z", "n": "7.0", "l": ["x", "y"], "st": "ACTIVE", "z": None}],
        {"low": {"path": "s", "transform": "lower"}, "up": {"path": "s", "transform": "upper"}, "bo": {"path": "b", "transform": "bool"},
         "da": {"path": "d", "transform": "date"}, "ii": {"path": "n", "transform": "int"}, "jj": {"path": "l", "transform": "join"},
         "ff": {"path": "l", "transform": "first"}, "m": {"path": "st", "map": {"active": "on", "_default": "other"}},
         "df": {"path": "z", "default": "fallback"}, "c": {"const": "aws"}, "miss": "nothing.here"})
    assert rows[0] == {"low": "hello", "up": "HELLO", "bo": "true", "da": "2026-10-31", "ii": "7", "jj": "x;y", "ff": "x", "m": "on", "df": "fallback", "c": "aws", "miss": ""}
    assert empty["miss"] == 1 and empty["df"] == 0


@pytest.mark.parametrize("spec", [{"transform": "lower"}, {"path": "x", "transform": "eval"}, {"path": "x", "typo": 1}, 5, {"path": "x", "map": 3}])
def test_a_bad_mapping_is_refused(spec):
    with pytest.raises(MapError):
        map_records([{"x": 1}], {"col": spec})


# ---------------------------------------------------------------------------- config

def test_the_shipped_example_config_is_valid():
    cfg = load_config(ROOT / "examples" / "automation" / "beyond90.toml")
    assert [s.target for s in cfg.sources] == ["accounts", "inventory", "activations", "findings"] and cfg.allow_hosts == ["127.0.0.1"]


@pytest.mark.parametrize("mutate,needle", [
    (lambda t: t.replace('target = "accounts"', 'targt = "accounts"'), "unknown key 'targt'"),
    (lambda t: t.replace("owner = \"team\"", "ownr = \"team\""), "'ownr' is not a column of accounts.csv (did you mean 'owner'?)"),
    (lambda t: t.replace('provider = "plat"\n', ""), "must supply provider"),
    (lambda t: t.replace('allow_hosts = ["127.0.0.1"]', 'allow_hosts = ["other.example"]'), "not in [security] allow_hosts"),
    (lambda t: t.replace("http://127.0.0.1", "http://vendor.example", 1).replace('allow_hosts = ["127.0.0.1"]', 'allow_hosts = ["vendor.example"]'), "must be https"),
    (lambda t: t.replace('[source.auth]\nenv = "T_TOKEN"\n', '[source.headers]\nAuthorization = "Bearer abc"\n', 1), "put secret header"),
    (lambda t: t.replace('target = "accounts"\ntag = "org"', 'target = "accounts"\ntag = "bogus"'), "tag is required for accounts"),
    (lambda t: t.replace('name = "caps"', 'name = "assets"'), "used more than once"),
    (lambda t: t + '\n[customer2]\nx = 1\n', "unknown section 'customer2'"),
    (lambda t: t.replace('name = "Test Co"', 'name = "Test Co"\nas_of = 2026-01-01'), "as_of is set by each run"),
    (lambda t: t.replace('type = "cursor"', 'type = "teleport"', 1), "pagination.type must be one of"),
])
def test_config_problems_are_reported_with_the_reason(tmp_path, mutate, needle):
    base = config_text("http://127.0.0.1:1")
    with pytest.raises(ConfigError) as e:
        cfg_for(tmp_path, mutate(base))
    assert needle in str(e.value)


def test_a_config_without_accounts_is_refused_and_every_problem_is_listed_together(tmp_path):
    text = config_text("http://127.0.0.1:1").replace('target = "accounts"', 'target = "teams"').replace('provider = "plat"\n', "")
    with pytest.raises(ConfigError) as e:
        cfg_for(tmp_path, text)
    assert len(e.value.errors) >= 2


def test_presets_expand_and_can_be_overridden(tmp_path):
    text = '[customer]\nname = "X"\n[[source]]\nname = "orgs"\npreset = "aws-org"\nargv = ["aws", "organizations", "list-accounts", "--profile", "audit"]\n[source.map]\nowner = "Email"\n'
    cfg = cfg_for(tmp_path, text)
    s = cfg.sources[0]
    assert s.argv[-1] == "audit" and s.mapping["owner"] == "Email" and s.mapping["id"] == "Id" and s.tag == "org" and "AWS_PROFILE" in s.env
    with pytest.raises(ConfigError, match="unknown preset"):
        cfg_for(tmp_path, '[customer]\nname = "X"\n[[source]]\nname = "o"\npreset = "nope"\n')


# ---------------------------------------------------------------------------- fetch

def test_cursor_pagination_reads_every_page_and_sends_the_token(api, tmp_path):
    cfg = cfg_for(tmp_path, config_text(api.base))
    recs = fetch_source(cfg.sources[0], cfg, env=ENV)
    assert [r["id"] for r in recs] == [f"t{i}" for i in range(1, 9)]
    assert len(api.log) == 3 and all(a == "Bearer t0ken" for _, _, a in api.log) and api.log[1][1] == {"cursor": "3"}


def test_other_pagination_styles(api, tmp_path):
    items = [{"id": str(i)} for i in range(7)]
    api.routes["/page"] = lambda q, h: (200, {"data": items[(int(q.get("page", 1)) - 1) * 3: int(q.get("page", 1)) * 3]}, {})
    api.routes["/off"] = lambda q, h: (200, {"data": items[int(q["offset"]): int(q["offset"]) + int(q["limit"])]}, {})
    api.routes["/link"] = lambda q, h: (200, {"data": items[int(q.get("p", 0)) * 4:(int(q.get("p", 0)) + 1) * 4]},
                                       {"Link": f'<{api.base}/link?p={int(q.get("p", 0)) + 1}>; rel="next"'} if int(q.get("p", 0)) == 0 else {})
    base = config_text(api.base)
    for path, pag, expected in (("/page", 'type = "page"\npage_param = "page"', 7), ("/off", 'type = "offset"\noffset_param = "offset"\nlimit_param = "limit"\nlimit = 3', 7),
                                ("/link", 'type = "link_header"', 7)):
        text = base.replace(f"{api.base}/tenants", f"{api.base}{path}", 1).replace('type = "cursor"\ncursor_path = "next"\ncursor_param = "cursor"', pag, 1)
        text = text.replace('id = "id"', 'id = "id"', 1)
        cfg = cfg_for(tmp_path, text)
        assert len(fetch_source(cfg.sources[0], cfg, env=ENV)) == expected, path


def test_a_missing_token_variable_is_named_and_the_token_is_never_in_a_message(api, tmp_path):
    cfg = cfg_for(tmp_path, config_text(api.base))
    with pytest.raises(FetchError) as e:
        fetch_source(cfg.sources[0], cfg, env={})
    assert "T_TOKEN is not set" in str(e.value)
    api.routes["/tenants"] = lambda q, h: (401, {}, {})
    with pytest.raises(FetchError) as e2:
        fetch_source(cfg.sources[0], cfg, env={"T_TOKEN": "SECRET-VALUE"})
    assert "HTTP 401" in str(e2.value) and "SECRET-VALUE" not in str(e2.value) and "check the token" in str(e2.value)


def test_transient_failures_are_retried_and_a_persistent_one_is_not_hidden(api, tmp_path):
    calls = {"n": 0}

    def flaky(q, h):
        calls["n"] += 1
        return (503, {}, {"Retry-After": "1"}) if calls["n"] < 3 else paged(TENANTS_ONE)(q, h)

    TENANTS_ONE = [{"id": "t1", "plat": "aws", "up": True, "team": "x", "state": "enabled"}]
    api.routes["/tenants"] = flaky
    cfg = cfg_for(tmp_path, config_text(api.base))
    waits: list[float] = []
    assert len(fetch_source(cfg.sources[0], cfg, env=ENV, sleep=waits.append)) == 1 and calls["n"] == 3 and waits == [1.0, 1.0]
    api.routes["/tenants"] = lambda q, h: (500, {}, {})
    with pytest.raises(FetchError, match="HTTP 500"):
        fetch_source(cfg.sources[0], cfg, env=ENV, sleep=lambda s: None)
    api.routes["/tenants"] = lambda q, h: (404, {}, {})
    n = len(api.log)
    with pytest.raises(FetchError, match="HTTP 404"):
        fetch_source(cfg.sources[0], cfg, env=ENV, sleep=lambda s: None)
    assert len(api.log) == n + 1                                          # a 404 is not retried


def test_a_redirect_to_a_host_that_is_not_allowed_is_refused(api, tmp_path):
    api.routes["/tenants"] = lambda q, h: (302, {}, {"Location": "http://evil.example/steal"})
    cfg = cfg_for(tmp_path, config_text(api.base))
    with pytest.raises(FetchError, match="not in allow_hosts|only https"):
        fetch_source(cfg.sources[0], cfg, env=ENV)


def test_oversize_loops_and_junk_are_stopped(api, tmp_path):
    cfg = cfg_for(tmp_path, config_text(api.base, extra="max_bytes = 200"))
    api.routes["/tenants"] = lambda q, h: (200, b"x" * 1000, {})
    with pytest.raises(FetchError, match="larger than max_bytes"):
        fetch_source(cfg.sources[0], cfg, env=ENV)
    cfg = cfg_for(tmp_path, config_text(api.base))
    api.routes["/tenants"] = lambda q, h: (200, {"data": [{"id": "a"}], "next": "same"}, {})
    with pytest.raises(FetchError, match="cursor repeats"):
        fetch_source(cfg.sources[0], cfg, env=ENV)
    api.routes["/tenants"] = lambda q, h: (200, b"<html>not json</html>", {})
    with pytest.raises(FetchError, match="not valid JSON"):
        fetch_source(cfg.sources[0], cfg, env=ENV)
    api.routes["/tenants"] = lambda q, h: (200, {"other": []}, {})
    with pytest.raises(FetchError, match="no records at path 'data'"):
        fetch_source(cfg.sources[0], cfg, env=ENV)


def command_cfg(tmp_path, code, env="", extra=""):
    argv = json.dumps([sys.executable, "-c", code])
    text = f'''[customer]
name = "C"
[[source]]
name = "cmd"
type = "command"
argv = {argv}
target = "accounts"
tag = "org"
format = "json"
{env}
{extra}
[source.map]
id = "id"
provider = {{ const = "aws" }}
'''
    return cfg_for(tmp_path, text)


def test_a_command_source_reads_json_and_passes_only_the_named_environment(tmp_path):
    code = "import os, json; print(json.dumps([{'id': k} for k in sorted(os.environ) if k in ('KEEP','DROP','PATH')]))"
    cfg = command_cfg(tmp_path, code, env='env = ["KEEP"]')
    ids = [r["id"] for r in fetch_source(cfg.sources[0], cfg, env={"KEEP": "1", "DROP": "2", "PATH": "/usr/bin"})]
    assert ids == ["KEEP", "PATH"]


def test_a_command_is_never_run_through_a_shell(tmp_path):
    marker = tmp_path / "pwned"
    import json as j
    text = f'''[customer]
name = "C"
[[source]]
name = "cmd"
type = "command"
argv = [{j.dumps(sys.executable)}, "-c", "import sys, json; print(json.dumps([{{'id': sys.argv[1]}}]))", "$(touch {marker}); `touch {marker}`"]
target = "accounts"
tag = "org"
[source.map]
id = "id"
provider = {{ const = "aws" }}
'''
    cfg = cfg_for(tmp_path, text)
    recs = fetch_source(cfg.sources[0], cfg, env={"PATH": "/usr/bin:/bin"})
    assert "touch" in recs[0]["id"] and not marker.exists()


def test_command_failures_are_explained(tmp_path):
    with pytest.raises(FetchError, match="exited with status 3: boom"):
        c = command_cfg(tmp_path, "import sys; sys.stderr.write('boom'); sys.exit(3)")
        fetch_source(c.sources[0], c, env={"PATH": "/usr/bin:/bin"})
    c = command_cfg(tmp_path, "import time; time.sleep(5)", extra="timeout_seconds = 0.3")
    with pytest.raises(FetchError, match="did not finish"):
        fetch_source(c.sources[0], c, env={"PATH": "/usr/bin:/bin"})
    cfg = cfg_for(tmp_path, '[customer]\nname = "C"\n[[source]]\nname = "x"\ntype = "command"\nargv = ["definitely-not-installed-xyz"]\ntarget = "accounts"\ntag = "org"\n[source.map]\nid = "id"\nprovider = { const = "aws" }\n')
    with pytest.raises(FetchError, match="command not found"):
        fetch_source(cfg.sources[0], cfg, env={"PATH": "/usr/bin"})


def test_a_file_source_reads_csv_and_globs(tmp_path):
    (tmp_path / "drop").mkdir()
    (tmp_path / "drop" / "a.csv").write_text("acct,own\nx1,retail\n")
    (tmp_path / "drop" / "b.csv").write_text("acct,own\nx2,data\n")
    text = '[customer]\nname = "C"\n[[source]]\nname = "f"\ntype = "file"\npath = "drop/*.csv"\nformat = "csv"\ntarget = "accounts"\ntag = "billing"\n[source.map]\nid = "acct"\nowner = "own"\nprovider = { const = "aws" }\n'
    cfg = cfg_for(tmp_path, text)
    assert [r["acct"] for r in fetch_source(cfg.sources[0], cfg)] == ["x1", "x2"]
    cfg.sources[0].path = "nothing/*.csv"
    with pytest.raises(FetchError, match="no file matches"):
        fetch_source(cfg.sources[0], cfg)


# ---------------------------------------------------------------------------- sync

def run_sync(cfg, **kw):
    return sync(cfg, AS_OF, now=kw.pop("now", NOW), env=kw.pop("env", ENV), sleep=lambda s: None, **kw)


def test_sync_builds_a_data_directory_the_engine_can_load(api, tmp_path):
    cfg = cfg_for(tmp_path, config_text(api.base, customer_extra='renewal_date = 2027-03-31\nprofile = "cnapp"'))
    rep = run_sync(cfg)
    assert rep.counts == {"accounts": 8, "inventory": 16, "activations": 8, "findings": 5} and all(r.status == "ok" for r in rep.results)
    data, warnings = load_customer(rep.data_dir)
    assert data.name == "Test Co" and data.as_of == AS_OF and data.renewal_date == date(2027, 3, 31) and len(data.accounts) == 8 and warnings == []
    t1 = next(a for a in data.accounts if a.id == "t1")
    assert t1.connected is True and t1.sources == ("org",) and t1.owner == "retail"
    assert next(a for a in data.accounts if a.id == "t3").connected is False
    assert sum(1 for f in data.findings if f.severity == "critical") == 2 and data.findings[0].opened_at == date(2026, 10, 1)


def test_sync_is_idempotent(api, tmp_path):
    cfg = cfg_for(tmp_path, config_text(api.base))
    first = run_sync(cfg).data_dir
    a = {p.name: p.read_bytes() for p in first.iterdir()}
    b = {p.name: p.read_bytes() for p in run_sync(cfg).data_dir.iterdir()}
    assert a == b


def test_two_lists_are_merged_by_id_with_every_tag_kept_and_manual_rows_win_last(api, tmp_path):
    api.routes["/billing"] = paged([{"acct": "t1", "owner": "finance"}, {"acct": "zz", "owner": "ghost"}])
    extra = '''
[[source]]
name = "billing"
type = "http"
url = "{BASE}/billing"
target = "accounts"
tag = "billing"
records = "data"
[source.auth]
env = "T_TOKEN"
[source.pagination]
type = "cursor"
cursor_path = "next"
cursor_param = "cursor"
[source.map]
id = "acct"
provider = { const = "aws" }
owner = "owner"
'''.replace("{BASE}", api.base)
    cfg = cfg_for(tmp_path, config_text(api.base, extra_sources=extra))
    (cfg.state_dir / "manual").mkdir(parents=True)
    (cfg.state_dir / "manual" / "accounts.csv").write_text("id,owner\nt2,corrected-owner\n")
    data = load_customer(run_sync(cfg).data_dir)[0]
    by = {a.id: a for a in data.accounts}
    assert by["t1"].sources == ("billing", "org") and by["t1"].owner == "retail"            # first source keeps a value it has
    assert by["zz"].sources == ("billing",) and by["zz"].connected is False                  # known only to billing: the hidden-account signal
    assert by["t2"].owner == "corrected-owner" and "manual" in by["t2"].sources


def test_a_target_no_source_feeds_is_taken_from_the_manual_folder(api, tmp_path):
    cfg = cfg_for(tmp_path, config_text(api.base))
    (cfg.state_dir / "manual").mkdir(parents=True)
    (cfg.state_dir / "manual" / "contacts.csv").write_text("id,name,role\nc1,Dana,champion\n")
    data = load_customer(run_sync(cfg).data_dir)[0]
    assert [c.name for c in data.contacts] == ["Dana"]


def test_a_failing_source_falls_back_to_its_last_good_copy_and_says_how_old(api, tmp_path):
    cfg = cfg_for(tmp_path, config_text(api.base))
    run_sync(cfg)
    api.routes["/tenants"] = lambda q, h: (500, {}, {})
    rep = run_sync(cfg, now=NOW + timedelta(days=3))
    r = next(x for x in rep.results if x.name == "tenants")
    assert r.status == "stale" and r.age_days == 3 and "HTTP 500" in r.error and rep.counts["accounts"] == 8
    assert len(load_customer(rep.data_dir)[0].accounts) == 8                                    # the data was not emptied by the outage


def test_no_accounts_at_all_is_an_error_and_leaves_the_old_data_alone(api, tmp_path):
    cfg = cfg_for(tmp_path, config_text(api.base))
    good = run_sync(cfg).data_dir
    before = (good / "accounts.csv").read_text()
    for p in (cfg.state_dir / "cache").glob("*.json"):
        p.unlink()
    api.routes["/tenants"] = lambda q, h: (500, {}, {})
    with pytest.raises(SyncError, match="no list of accounts"):
        run_sync(cfg)
    assert (good / "accounts.csv").read_text() == before


def test_a_path_that_reads_nothing_is_a_failure_not_an_empty_file(api, tmp_path):
    cfg = cfg_for(tmp_path, config_text(api.base).replace('id = "id"\nprovider', 'id = "idd"\nprovider'))
    with pytest.raises(SyncError) as e:
        run_sync(cfg)
    assert "required column(s) id came out empty" in str(e.value)


def test_dry_run_writes_nothing(api, tmp_path):
    cfg = cfg_for(tmp_path, config_text(api.base))
    rep = run_sync(cfg, write=False)
    assert rep.counts["accounts"] == 8 and not (cfg.state_dir / "data").exists() and not (cfg.state_dir / "cache").exists()


def test_a_value_with_a_pipe_or_newline_is_cleaned_by_the_loader_after_sync(api, tmp_path):
    tenants = [{**row, "team": "bad | name\nnext"} if row["id"] == "t1" else row for row in TENANTS]
    api.routes["/tenants"] = paged(tenants)
    cfg = cfg_for(tmp_path, config_text(api.base))
    data, warnings = load_customer(run_sync(cfg).data_dir)
    assert next(a for a in data.accounts if a.id == "t1").owner == "bad ¦ name next" and any("replaced" in w for w in warnings)


def test_rows_for_accounts_nobody_listed_are_dropped_and_counted_not_fatal(api, tmp_path):
    api.routes["/tenants"] = paged(TENANTS[:4])
    cfg = cfg_for(tmp_path, config_text(api.base))
    rep = run_sync(cfg)
    assert rep.dropped["inventory"] == 8 and rep.dropped["activations"] == 4 and rep.counts["accounts"] == 4
    assert len(load_customer(rep.data_dir)[0].inventory) == 8


# Operating Beyond 90

What to expect when it runs unattended, and what it does when things go wrong.

## Inputs from any program

Spreadsheet programs save CSV in whatever their locale says. Beyond 90 reads UTF-8 (with or without a byte-order mark) and UTF-16. A file that is not valid UTF-8 is read as Windows-1252 and a warning says so, because reading it silently would turn accented letters into the wrong ones. A file with NUL bytes is not text and is refused. Malformed CSV (an unterminated quote, a field larger than the parser's limit) is reported with the file and line. `NaN`, `inf` and numbers too large for a count are refused as numbers.

Whatever the input, the loader returns data or raises one kind of error that lists every problem it found. This is checked by a seeded fuzzer (`tests/test_fuzz.py`): it mutates valid estates in 15 ways (cut files, garbage bytes, duplicated or dropped lines and columns, other delimiters, UTF-16, binary, swapped headers, wrong TOML types) and requires no crash and a sane score on whatever loads. `B90_FUZZ_CASES=6000 pytest tests/test_fuzz.py` runs more.

## A source that misbehaves

A vendor API can send half a body, hang up, answer in something that is not HTTP, nest JSON a hundred thousand levels deep, return a cursor that is an object, or a `Retry-After` of `nan`. Each ends as a `FetchError` that names the source and never includes the URL's secrets. With a last good copy, the source is reported **stale** with its age and the run continues; without one, it is reported **failed**, and a run with no accounts at all stops with a clear message.

## One run at a time

`run` takes `state/run.lock`. A second run while the first is active is refused with the path of the lock. A lock is taken over when its process no longer exists, when it cannot be read, or after six hours. The lock is released when a run fails.

## What is written, and when

The cache for each source and the dated output folder are written to a temporary name and renamed into place, so a crash leaves the previous good copy. `state/out/latest` is rebuilt from the new dated folder.

To keep the state directory from growing for ever, set:

```toml
[state]
keep_snapshots = 180   # dated folders under state/snapshots (default 180)
keep_outputs = 30      # dated folders under state/out (default 30)
```

`history.db` and `runs.jsonl` are never pruned; they are small and they are the record. Folders whose names are not dates are left alone.

If the state directory cannot be written or the disk is full, the run stops with a message saying which path and what to check. The state directory holds customer data: keep it private and back it up if the history matters.

## Browser app limits

A workspace file with more than 1000 snapshots is refused with a message (split it by customer). Snapshots whose fields have the wrong type, or whose content does not match their name, are rejected and counted, not half trusted. A key called `__proto__` in an imported file is ignored. If the engine crashes, the next request starts a new one. If the browser's storage is full, the message says so and what to do.

## Size

Planning is the expensive step, and it grows faster than the estate: each pick re-scores the candidates. Measured on one core, in Python 3.13:

| Active accounts | Findings | Load | Score | Full analysis with plan |
|---|---|---|---|---|
| 500 | 5,000 | 0.1 s | 0.01 s | 15 s |
| 5,000 | 50,000 | 1.4 s | 0.2 s | 185 s |

Scoring is linear and fast at any size. For a very large estate, run the book per business unit, or lower `hours_per_week` and `weeks` in `[outputs]`, which reduces the number of picks. In the browser the same work runs in the page, so keep estates under a few hundred accounts there.

## What is checked

An independent reimplementation of the four stages (`tests/test_differential.py`) reads the raw CSV files and must agree with the engine to 1e-12 on 150 random estates. The test suite runs on Python 3.11, 3.12 and 3.13; the browser tests run Chromium against the built site, offline, with an accessibility audit.

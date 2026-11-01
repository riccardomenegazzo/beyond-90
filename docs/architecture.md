# Architecture notes: what the data-systems book changed

Version 0.7 restructures how Beyond 90 treats data, in the browser app and in the engine. The ideas come from *Designing Data-Intensive Applications*, 2nd edition (Kleppmann and Riccomini), read here as the early-release chapters 1, 2, 3, 5 and 6. The book is paraphrased, never reproduced, and it is an unfinished edition: later chapters (transactions, consistency, derived data in depth) are not read, so nothing below claims more than those chapters support.

## 1. System of record, and everything else derived

The customer's files are the system of record. A score, a plan, a report and a QBR are derived: lose them and you rebuild them from the inputs. The app and the engine now behave that way.

- Saved snapshots hold **inputs only**. Results are recomputed on demand and kept in memory, so a stored result can never disagree with its data or with a newer engine.
- Every score carries a **provenance record**: the hash of each input file, one hash for the whole input, the engine version, the catalogue hash and the ceiling. Reports print it in their footer. "Same inputs, same engine, same numbers" is a checkable sentence, and `beyond90 fingerprint DIR` prints the hash.
- The hash ignores a byte-order mark and line endings (spreadsheet exports differ) and nothing else. Files that are not inputs cannot change it.

## 2. Immutable facts and content-addressed names

A snapshot is a record that something happened: these files were the customer on that date. It is never edited. Its name is the hash of its content, so saving it twice is a no-op, a copy on another device is recognised as the same snapshot, and a copy whose content does not match its name is rejected on import. This borrows the book's event-log idea in a small way. It is **not** full event sourcing: the log holds whole snapshots, not fine-grained events, because the unit a TAM works with is a monthly export.

## 3. Old and new must coexist

The book's point is that, in any system people upgrade at different times, old and new code and data meet. Backward compatibility (new reads old) is the easy half; forward compatibility (old reads new) needs deliberate tolerance, and an old reader that rewrites a record can silently drop what it did not understand. What that changed:

| Place | Rule |
|---|---|
| Input files | `customer.toml` can carry `schema_version`. A file for a newer format is refused with advice; an older or missing version is read. |
| Unknown columns and keys | Ignored, with a warning that suggests the nearest known name (`ownr` → `owner`). A typo no longer silently becomes a default. |
| Workspace file | Carries `format` and `version`. A newer major version is refused with a message. Unknown fields, at the top and on each snapshot, are kept through import, merge and export, which is exactly the loss the book warns about. |
| Offline cache | A new build waits until every tab on the old build is closed, then replaces the whole cache at once. A page never runs against another build's worker or engine. |

## 4. Sync without a server

Each browser holds a replica and works offline, which the book calls local-first: the app keeps working if its author's server disappears, because there is none. Two workspaces merge by **set union of snapshots**. Union is commutative, associative and idempotent, so two devices can exchange files in any order, any number of times, and agree. Where the same snapshot carries different metadata, a fixed rule picks the earliest save date and the smaller value, whatever the order. Tests assert all three properties.

One limit is deliberate and stated: **deletion does not propagate**. Merging by union means a snapshot deleted on one device returns if another device still has it. Tombstones would fix that, at the cost of a format change; until then, "Forget everything" is local to the browser it is pressed in.

## 5. Describing performance honestly

The book is blunt that averages hide what users feel and that percentiles cannot be averaged. Time to remediate is now reported as the **median and 90th percentile** (nearest-rank, always an observed value), with the mean kept for continuity. The QBR says "one in ten took N days or more". Anything that combines customers must pool observations or add histograms, never average percentiles; the portfolio view does not aggregate remediation times for that reason.

## 6. Isolation, cancellation, and not melting down

The engine runs in a worker, so a 104-week plan cannot freeze the page. Requests carry ids; cancelling terminates the worker and starts a fresh one (the only way to stop synchronous Python), and a request made during the restart waits for it instead of failing. Input is capped at 20 MB per file. The book's warnings about retries and overload apply here in small: there are no automatic retries anywhere, because a retry of a deterministic computation can only repeat the failure.

## 7. Privacy as an architecture property

The worker is started from a blob URL because a worker from a plain URL on a static host has no Content Security Policy of its own, whereas a blob worker inherits the page's (`connect-src 'self'`). The footer has a button that tries to reach another site from the page and from the worker and reports that the browser blocked both; the end-to-end test asserts it. Saved snapshots leave out contacts and commitments unless the person opts in, because they hold personal data.

## What was not taken

Real-time collaboration, conflict-free editing of shared documents, consensus and sharding are in the book and out of scope: nothing here is edited by two people at once, and a customer folder fits in one tab. Adding any of them would add machinery for a problem this tool does not have.

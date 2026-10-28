# CampusReserve

A campus room reservation platform. People book rooms, join a waitlist when a
slot is taken, and get the slot when it frees up. Staff price the bookings,
manage the catalog from a command line, and read reports off the event log.

Java 21 across seven Maven modules, plus a Python 3.11 analytics package. No
runtime dependencies on either side. The HTTP server is
`com.sun.net.httpserver`, the event log is JSON Lines written by hand, and the
Python package is standard library only.

## Modules

| Module | What it holds |
|---|---|
| `core-domain` | Rooms, bookings, the waitlist, and the booking rules. Depends on nothing. |
| `storage` | In-memory implementations of the domain's store ports, and the writer that appends the event log. |
| `notifications` | Message templates, an outbox, and delivery with a retry policy. |
| `accounts` | Accounts, roles, bearer tokens, and the authorization checks. |
| `billing` | Price rules and invoices. The price is snapshotted when the invoice is issued. |
| `http-api` | The HTTP endpoints over the booking service, with token checks. |
| `cli` | Administrative commands, including `export-events`, which writes `events.jsonl`. |
| `analytics/` (Python) | Utilization and revenue reports, read from `events.jsonl`. |

`ARCHITECTURE.md` has the module diagram and the data flow.

## Build and test

From this directory:

```
mvn -B test
```

And for the Python side, from `analytics/`:

```
pytest
```

`SETUP.md` has the per-module gate commands, the expected test counts, and what
green looks like.

## Running it

Compile once, then run either entry point straight off the class files. There is
no plugin to fetch and no jar to assemble.

```
mvn -q -DskipTests package
```

The HTTP API. It prints a bearer token for each of the two seeded accounts, one
member and one administrator, so ownership and administrator checks can both be
tried with curl:

```
java -cp "http-api/target/classes:core-domain/target/classes:storage/target/classes:notifications/target/classes:accounts/target/classes" \
  edu.cmu.cs214.campusreserve.http.CampusReserveServer 8080

curl http://localhost:8080/rooms
```

The administrative commands. Each run builds a fresh in-memory platform, so
chain commands with a bare `+` when a later one needs what an earlier one did:

```
java -cp "cli/target/classes:core-domain/target/classes:storage/target/classes:billing/target/classes" \
  edu.cmu.cs214.campusreserve.cli.CampusReserveCli help

java -cp "cli/target/classes:core-domain/target/classes:storage/target/classes:billing/target/classes" \
  edu.cmu.cs214.campusreserve.cli.CampusReserveCli seed + export-events --out events.jsonl
```

The reports, against that exported log:

```
cd analytics
python -m campusreserve_analytics utilization --events ../events.jsonl
python -m campusreserve_analytics revenue --events ../events.jsonl --format csv
```

## Where things are

- Repository conventions, and the rules any change has to keep: `AGENTS.md`
  (`CLAUDE.md` imports it).
- Architecture: `ARCHITECTURE.md`
- Setup and the per-module gates: `SETUP.md`
- CI: `.github/workflows/ci.yml`, which runs the same two commands as above.

## Lab 9: running it as copies

`compose.yaml` and `load/` are the lab's additions; `BOUNDARIES.md` holds the
write-up. `docker compose up -d --build --scale api=2`, wait about 8 seconds,
then `bash load/run.sh tokens.js` or `bash load/run.sh bookings.js`.

## Tools used for this lab

Claude Code 2.1.268 (VS Code extension) running Claude Opus 5.5
(`claude-opus-5-5`). It traced the wiring, drafted `compose.yaml`, the k6
scripts, and `BOUNDARIES.md`, and ran the stack and the scripts. No transcripts
are committed (lab forks are public).

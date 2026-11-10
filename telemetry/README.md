# Renplay telemetry collector

A Cloudflare Worker with a D1 database that receives the daily usage report of Renplay instances at
`https://telemetry.renplay.org`. What Renplay sends, and how to turn it off, is on the
[Telemetry page of the docs](https://docs.renplay.org/telemetry/).

## What it receives

`POST /v1/report` takes a JSON report of schema 1, under 64 KB: the instance's random id, its version, the
day (UTC), its setup (architecture, install method, sign-in kind, adult level, size bands), counts of its
users, devices, games and saves, the day's play and feature counts, and per catalog game the installs,
plays and errors. Games are named only by catalog recipe id. Error messages are cleaned again here: the
first line only, 200 characters at most, and anything in quotes, URLs, paths, email addresses, IP addresses
and numbers longer than 6 digits replaced by `<x>`.

The answer is `204` when the report is counted, `400` with a short reason when it is not valid, and `429`
when the instance has sent more than 3 reports in 20 hours. `GET /` answers one line of text. Everything
else is `404`.

A report is refused when its day is more than 3 days from the collector's date. Unknown fields are ignored
and missing counts count as zero. An instance counts once a day: a second report for the same instance and
day only counts toward the rate limit.

## What it keeps

`schema.sql` is the whole database:

- `instances`: one row per instance, to count active and new instances, versions and setups.
- `instance_days`: one row per instance and day.
- `game_days`, `error_days` and `usage_days`: counters per day, summed over all instances. They have no
  instance id, so a game's numbers cannot be traced to an instance.
- `rate_limits`: when each instance reported, kept for a day.

A daily cron deletes rows older than 400 days.

## What it never keeps

The IP address, any request header, the report itself, usernames, paths, URLs of a person's server,
save contents, tokens or free text. The Worker reads only the `content-type` and `content-length`
headers, to check them, and never the address of the sender. `test/collector.test.ts` checks every table
for the address and the headers it sent.

Cloudflare itself sees every request, as it does for any site it serves. That is outside this Worker.

## Development

```sh
npm ci
npx tsc --noEmit      # type check
npm test              # the tests, in the Workers runtime with a local D1
npx wrangler deploy --dry-run --outdir /tmp/renplay-telemetry-dry
```

## Deploy

```sh
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... sh telemetry/deploy.sh
```

The script creates the D1 database `renplay-telemetry` if it is missing, applies `schema.sql` (safe to apply
again), and runs `wrangler deploy`, which also sets the custom domain `telemetry.renplay.org` and the daily
cron. The token needs the Workers Scripts and D1 edit permissions for the account, and Workers Routes and
DNS edit for the `renplay.org` zone. The database id goes into a copy of `wrangler.toml` that git ignores.

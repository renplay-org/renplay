---
title: Dashboards
description: Prometheus metrics for admins, and a widget for Homepage and other dashboards.
---

Renplay answers two dashboard addresses. Both take an access token, so a dashboard on another
machine can read them without a session: make one in **Account → Access tokens** and send it as
`Authorization: Bearer <token>`.

## Prometheus metrics

`/metrics` gives counts about the server in the Prometheus text format. It is for admins only (an
admin's token), and it never names a game.

| Metric | What it counts |
|---|---|
| `renplay_info{version}` | The version, always 1 |
| `renplay_games{status}` | Games in the library, by status |
| `renplay_people` | People with an account that is not disabled |
| `renplay_jobs{status}` | Installs and other jobs running or waiting |
| `renplay_save_files` | Save files across everyone |
| `renplay_play_sessions_total` | Play sessions recorded |
| `renplay_play_seconds_total` | Seconds played, across everyone |
| `renplay_catalog_recipes` | Recipes in the catalog |
| `renplay_catalog_updated_seconds` | When the catalog was last updated (Unix seconds) |
| `renplay_backup_last_seconds` | When the last save backup was written (0 for none) |
| `renplay_disk_free_bytes{volume}`, `renplay_disk_size_bytes{volume}` | Free space and size of the games and data volumes |

A scrape job:

```yaml
scrape_configs:
  - job_name: renplay
    scheme: https
    metrics_path: /metrics
    authorization:
      credentials: <an admin's access token>
    static_configs:
      - targets: [renplay.example.com]
```

## A widget for Homepage

`/api/widget` gives a short JSON answer for the person whose token it is, with their adult games
level applied:

```json
{
  "version": "__RENPLAY_VERSION__",
  "games": 21,
  "installed": 20,
  "installing": 0,
  "playedTodayMinutes": 35,
  "lastPlayed": "Dear Devere",
  "recent": [{ "id": "dear-devere", "title": "Dear Devere", "playedAt": "2026-11-08T09:12:44.000Z" }]
}
```

For [Homepage](https://gethomepage.dev)'s custom API widget:

```yaml
- Renplay:
    href: https://renplay.example.com
    widget:
      type: customapi
      url: https://renplay.example.com/api/widget
      headers:
        Authorization: Bearer <your access token>
      mappings:
        - field: games
          label: Games
        - field: playedTodayMinutes
          label: Played today
          suffix: min
        - field: lastPlayed
          label: Last played
```

With sign-in off, both addresses answer without a token, for the account everyone uses.

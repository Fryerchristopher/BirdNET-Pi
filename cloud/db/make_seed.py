#!/usr/bin/env python3
"""
Generate db/seed-journal.sql: two years of plausible detections for local
development, so the Field Journal pages have something to show.

  python3 db/make_seed.py > db/seed-journal.sql
  cd worker && npx wrangler d1 execute birdnet-pi --local --file=../db/seed-journal.sql
"""
import random
from datetime import date, datetime, timedelta

random.seed(7)
TODAY = date.today()
NOW_H = datetime.now().hour

# name, sci, daily peak (mean per day in season), season months (1..12) or None for resident, peak hour
SPECIES = [
    ("Red-breasted Nuthatch", "Sitta canadensis", 70, None, 8),
    ("Golden-crowned Kinglet", "Regulus satrapa", 28, None, 8),
    ("Northern Flicker", "Colaptes auratus", 12, None, 9),
    ("Common Raven", "Corvus corax", 9, None, 11),
    ("Brown Creeper", "Certhia americana", 9, None, 7),
    ("Mountain Chickadee", "Poecile gambeli", 5, None, 8),
    ("Steller's Jay", "Cyanocitta stelleri", 4, None, 9),
    ("Pileated Woodpecker", "Dryocopus pileatus", 3, None, 10),
    ("Dark-eyed Junco", "Junco hyemalis", 3, [10, 11, 12, 1, 2, 3, 4], 8),
    ("White-headed Woodpecker", "Dryobates albolarvatus", 2, None, 10),
    ("Hairy Woodpecker", "Dryobates villosus", 2, None, 9),
    ("Hermit Thrush", "Catharus guttatus", 1.5, [10, 11, 12, 1, 2, 3], 6),
    ("Townsend's Solitaire", "Myadestes townsendi", 1, [10, 11, 12, 1, 2, 3], 7),
    ("Western Tanager", "Piranga ludoviciana", 6, [5, 6, 7, 8, 9], 7),
    ("Black-headed Grosbeak", "Pheucticus melanocephalus", 5, [5, 6, 7, 8, 9], 7),
    ("Hermit Warbler", "Setophaga occidentalis", 4, [5, 6, 7, 8], 6),
    ("Evening Grosbeak", "Coccothraustes vespertinus", 2, None, 9),
    ("Great Horned Owl", "Bubo virginianus", 0.6, None, 22),
    ("Mountain Quail", "Oreortyx pictus", 1, [4, 5, 6, 7], 7),
    ("American Robin", "Turdus migratorius", 3, [3, 4, 5, 6, 7, 8, 9, 10], 6),
]


def safe(n):
    return n.replace("'", "").replace(" ", "_")


def esc(s):
    return s.replace("'", "''")


rows = []
start = TODAY - timedelta(days=640)
d = start
while d <= TODAY:
    for com, sci, peak, season, ph in SPECIES:
        if season and d.month not in season:
            continue
        lam = peak * 0.18 * (0.6 + random.random() * 0.8)
        n = max(0, int(random.gauss(lam, lam * 0.4)))
        if d == TODAY:
            n = int(n * 0.6)
        for _ in range(n):
            h = int(min(23, max(0, random.gauss(ph, 2.2))))
            if d == TODAY and h > NOW_H:
                continue
            m, s = random.randrange(60), random.randrange(60)
            conf = min(0.99, max(0.7, random.gauss(0.84, 0.07)))
            t = f"{h:02d}:{m:02d}:{s:02d}"
            fn = f"{safe(com)}-{round(conf*100)}-{d.isoformat()}-birdnet-{t}.mp3"
            rows.append((d.isoformat(), t, sci, com, round(conf, 4), fn))
    d += timedelta(days=1)

# a few new-this-week and quiet-this-week signals
rows = [r for r in rows if not (r[2] == "Catharus guttatus" and TODAY - timedelta(days=13) <= date.fromisoformat(r[0]) <= TODAY - timedelta(days=6))]

print("INSERT OR REPLACE INTO stations (id, name, timezone, lat, lon, last_seen_at, pi_version, agent_version, disk_used_pct, backlog_files, config_json)")
print("VALUES ('default', 'Demo Station', 'America/Los_Angeles', 37.7749, -122.4194, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'abc1234', '0.1.0', 41.2, 3, '{\"RECORDING_LENGTH\":\"15\",\"CONFIDENCE\":\"0.7\"}');")
print("INSERT OR IGNORE INTO labels (station_id, sci_name, com_name, com_en_name) VALUES")
print(",\n".join(f"('default','{esc(sci)}','{esc(com)}','{esc(com)}')" for com, sci, *_ in SPECIES) + ";")
print("DELETE FROM detections WHERE station_id = 'default';")
B = 120
for i in range(0, len(rows), B):
    chunk = rows[i:i + B]
    print("INSERT OR IGNORE INTO detections (station_id, date, time, sci_name, com_name, confidence, lat, lon, cutoff, week, sens, overlap, file_name, com_name_safe, media_key, has_audio, has_png) VALUES")
    vals = []
    for dt, t, sci, com, conf, fn in chunk:
        key = f"by_date/{dt}/{safe(com)}/{fn}"
        vals.append(f"('default','{dt}','{t}','{esc(sci)}','{esc(com)}',{conf},37.7749,-122.4194,0.7,{date.fromisoformat(dt).isocalendar()[1]},1.25,0,'{esc(fn)}','{esc(safe(com))}','{esc(key)}',1,1)")
    print(",\n".join(vals) + ";")
import sys
print(f"-- {len(rows)} rows", file=sys.stderr)

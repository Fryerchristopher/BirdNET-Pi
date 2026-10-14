-- Sample data for local development (npm run db:seed:local). Dates are
-- relative to "now" so the Overview has something to show.
INSERT OR REPLACE INTO stations (id, name, timezone, lat, lon, last_seen_at, analyzing_now, pi_version, agent_version, disk_used_pct, backlog_files, config_json)
VALUES ('default', 'Demo Station', 'America/Los_Angeles', 38.3, -120.3, strftime('%Y-%m-%dT%H:%M:%fZ','now'), '2026-10-14-birdnet-07:14:00.wav', 'abc1234', '0.1.0', 41.2, 3, '{"MODEL":"BirdNET_GLOBAL_6K_V2.4_Model_FP16","CONFIDENCE":"0.7","SENSITIVITY":"1.25","OVERLAP":"0.0","RECORDING_LENGTH":"15"}');

INSERT OR IGNORE INTO labels (station_id, sci_name, com_name, com_en_name) VALUES
 ('default','Melanerpes formicivorus','Acorn Woodpecker','Acorn Woodpecker'),
 ('default','Cyanocitta stelleri','Steller''s Jay','Steller''s Jay'),
 ('default','Poecile gambeli','Mountain Chickadee','Mountain Chickadee'),
 ('default','Sitta carolinensis','White-breasted Nuthatch','White-breasted Nuthatch'),
 ('default','Ixoreus naevius','Varied Thrush','Varied Thrush'),
 ('default','Junco hyemalis','Dark-eyed Junco','Dark-eyed Junco');

INSERT OR IGNORE INTO detections (station_id, date, time, sci_name, com_name, confidence, lat, lon, cutoff, week, sens, overlap, file_name, com_name_safe, media_key, has_audio, has_png)
VALUES
 ('default', date('now','localtime'), '07:14:22', 'Melanerpes formicivorus', 'Acorn Woodpecker', 0.87, 38.3, -120.3, 0.7, 42, 1.25, 0, 'Acorn_Woodpecker-87-' || date('now','localtime') || '-birdnet-07:14:22.mp3', 'Acorn_Woodpecker', 'by_date/' || date('now','localtime') || '/Acorn_Woodpecker/Acorn_Woodpecker-87-' || date('now','localtime') || '-birdnet-07:14:22.mp3', 0, 0),
 ('default', date('now','localtime'), '07:20:01', 'Cyanocitta stelleri', 'Steller''s Jay', 0.93, 38.3, -120.3, 0.7, 42, 1.25, 0, 'Stellers_Jay-93-' || date('now','localtime') || '-birdnet-07:20:01.mp3', 'Stellers_Jay', 'by_date/' || date('now','localtime') || '/Stellers_Jay/Stellers_Jay-93-' || date('now','localtime') || '-birdnet-07:20:01.mp3', 0, 0),
 ('default', date('now','localtime'), '08:02:45', 'Poecile gambeli', 'Mountain Chickadee', 0.78, 38.3, -120.3, 0.7, 42, 1.25, 0, 'Mountain_Chickadee-78-' || date('now','localtime') || '-birdnet-08:02:45.mp3', 'Mountain_Chickadee', 'by_date/' || date('now','localtime') || '/Mountain_Chickadee/Mountain_Chickadee-78-' || date('now','localtime') || '-birdnet-08:02:45.mp3', 0, 0),
 ('default', date('now','localtime'), '09:31:10', 'Ixoreus naevius', 'Varied Thrush', 0.71, 38.3, -120.3, 0.7, 42, 1.25, 0, 'Varied_Thrush-71-' || date('now','localtime') || '-birdnet-09:31:10.mp3', 'Varied_Thrush', 'by_date/' || date('now','localtime') || '/Varied_Thrush/Varied_Thrush-71-' || date('now','localtime') || '-birdnet-09:31:10.mp3', 0, 0),
 ('default', date('now','localtime','-1 day'), '06:50:00', 'Melanerpes formicivorus', 'Acorn Woodpecker', 0.81, 38.3, -120.3, 0.7, 42, 1.25, 0, 'Acorn_Woodpecker-81-' || date('now','localtime','-1 day') || '-birdnet-06:50:00.mp3', 'Acorn_Woodpecker', 'by_date/' || date('now','localtime','-1 day') || '/Acorn_Woodpecker/Acorn_Woodpecker-81-' || date('now','localtime','-1 day') || '-birdnet-06:50:00.mp3', 0, 0),
 ('default', date('now','localtime','-3 day'), '17:05:12', 'Sitta carolinensis', 'White-breasted Nuthatch', 0.88, 38.3, -120.3, 0.7, 42, 1.25, 0, 'White-breasted_Nuthatch-88-' || date('now','localtime','-3 day') || '-birdnet-17:05:12.mp3', 'White-breasted_Nuthatch', 'by_date/' || date('now','localtime','-3 day') || '/White-breasted_Nuthatch/White-breasted_Nuthatch-88-' || date('now','localtime','-3 day') || '-birdnet-17:05:12.mp3', 0, 0),
 ('default', date('now','localtime','-9 day'), '12:00:00', 'Junco hyemalis', 'Dark-eyed Junco', 0.95, 38.3, -120.3, 0.7, 41, 1.25, 0, 'Dark-eyed_Junco-95-' || date('now','localtime','-9 day') || '-birdnet-12:00:00.mp3', 'Dark-eyed_Junco', 'by_date/' || date('now','localtime','-9 day') || '/Dark-eyed_Junco/Dark-eyed_Junco-95-' || date('now','localtime','-9 day') || '-birdnet-12:00:00.mp3', 0, 0),
 ('default', date('now','localtime','-60 day'), '12:00:00', 'Ixoreus naevius', 'Varied Thrush', 0.75, 38.3, -120.3, 0.7, 34, 1.25, 0, 'Varied_Thrush-75-' || date('now','localtime','-60 day') || '-birdnet-12:00:00.mp3', 'Varied_Thrush', 'by_date/' || date('now','localtime','-60 day') || '/Varied_Thrush/Varied_Thrush-75-' || date('now','localtime','-60 day') || '-birdnet-12:00:00.mp3', 0, 0);

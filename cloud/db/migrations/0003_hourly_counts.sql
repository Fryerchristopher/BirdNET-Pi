-- hourly_counts: detections per station, date, hour and species, kept in step
-- with detections by the triggers below. The Field Journal's species, archive
-- and history views read this (tens of thousands of rows) instead of scanning
-- every detection (hundreds of thousands). Safe to re-run: the backfill
-- recounts from detections and overwrites.

CREATE TABLE IF NOT EXISTS hourly_counts (
  station_id  TEXT    NOT NULL,
  date        TEXT    NOT NULL,            -- YYYY-MM-DD, station local time
  hour        INTEGER NOT NULL,            -- 0..23, station local time
  sci_name    TEXT    NOT NULL,
  com_name    TEXT    NOT NULL,
  n           INTEGER NOT NULL,
  PRIMARY KEY (station_id, date, hour, sci_name)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS hourly_counts_sci ON hourly_counts (station_id, sci_name, date);

-- Best clips with audio for a species (most detections have no clip in R2).
CREATE INDEX IF NOT EXISTS detections_audio_conf ON detections (station_id, sci_name, confidence DESC) WHERE has_audio = 1;

CREATE TRIGGER IF NOT EXISTS detections_hc_insert AFTER INSERT ON detections BEGIN
  INSERT INTO hourly_counts (station_id, date, hour, sci_name, com_name, n)
  VALUES (NEW.station_id, NEW.date, CAST(substr(NEW.time, 1, 2) AS INTEGER), NEW.sci_name, NEW.com_name, 1)
  ON CONFLICT (station_id, date, hour, sci_name) DO UPDATE SET n = n + 1, com_name = excluded.com_name;
END;

CREATE TRIGGER IF NOT EXISTS detections_hc_delete AFTER DELETE ON detections BEGIN
  UPDATE hourly_counts SET n = n - 1
   WHERE station_id = OLD.station_id AND date = OLD.date AND hour = CAST(substr(OLD.time, 1, 2) AS INTEGER) AND sci_name = OLD.sci_name;
  DELETE FROM hourly_counts
   WHERE station_id = OLD.station_id AND date = OLD.date AND hour = CAST(substr(OLD.time, 1, 2) AS INTEGER) AND sci_name = OLD.sci_name AND n <= 0;
END;

-- Relabels (ingest's species fix-up, re-sent rows with a new name) move the count.
CREATE TRIGGER IF NOT EXISTS detections_hc_update AFTER UPDATE OF station_id, date, time, sci_name, com_name ON detections
WHEN OLD.station_id IS NOT NEW.station_id OR OLD.date IS NOT NEW.date OR substr(OLD.time, 1, 2) IS NOT substr(NEW.time, 1, 2)
  OR OLD.sci_name IS NOT NEW.sci_name OR OLD.com_name IS NOT NEW.com_name
BEGIN
  UPDATE hourly_counts SET n = n - 1
   WHERE station_id = OLD.station_id AND date = OLD.date AND hour = CAST(substr(OLD.time, 1, 2) AS INTEGER) AND sci_name = OLD.sci_name;
  DELETE FROM hourly_counts
   WHERE station_id = OLD.station_id AND date = OLD.date AND hour = CAST(substr(OLD.time, 1, 2) AS INTEGER) AND sci_name = OLD.sci_name AND n <= 0;
  INSERT INTO hourly_counts (station_id, date, hour, sci_name, com_name, n)
  VALUES (NEW.station_id, NEW.date, CAST(substr(NEW.time, 1, 2) AS INTEGER), NEW.sci_name, NEW.com_name, 1)
  ON CONFLICT (station_id, date, hour, sci_name) DO UPDATE SET n = n + 1, com_name = excluded.com_name;
END;

-- Backfill. WHERE true keeps the parser from reading ON CONFLICT as a join.
INSERT INTO hourly_counts (station_id, date, hour, sci_name, com_name, n)
SELECT station_id, date, CAST(substr(time, 1, 2) AS INTEGER), sci_name, MAX(com_name), COUNT(*)
  FROM detections WHERE true
 GROUP BY station_id, date, CAST(substr(time, 1, 2) AS INTEGER), sci_name
ON CONFLICT (station_id, date, hour, sci_name) DO UPDATE SET n = excluded.n, com_name = excluded.com_name;

ANALYZE;

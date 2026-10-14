#!/usr/bin/env python3
"""
BirdNET-Pi Cloud agent.

Runs on the Pi next to BirdNET-Pi and turns it into a collector:

  * pushes every new row of birds.db to the cloud (high-water mark on rowid)
  * uploads each extracted clip and its spectrogram PNG to R2 through the Worker
  * pushes the live spectrogram, the StreamData *.wav.json sidecar and the daily
    Combo chart so the Overview and Spectrogram pages keep their live feel
  * sends a status heartbeat (timezone, location, disk, backlog, versions)
  * polls the cloud for commands (delete, re-identify, lock, shift, list sync,
    service restarts) and executes them locally, then acks

The Pi never accepts inbound connections. Everything is HTTPS to the Worker
with a bearer token. Standard library only, so it runs on a stock BirdNET-Pi
without extra packages.

Config: /etc/birdnet/cloud_agent.conf (see install.sh), KEY=VALUE lines:
  CLOUD_URL=https://birds.example.com
  INGEST_TOKEN=...
  STATION_ID=default
  PUSH_INTERVAL=10          seconds between push cycles
  HEARTBEAT_INTERVAL=60
  UPLOAD_MEDIA=1            0 = rows only, no audio/png (cloud pages show no players)
  PURGE_SCAN_HOUR=4         local hour for the daily "which files are gone" scan
"""
import glob
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

AGENT_VERSION = '0.1.0'
HOME = os.path.expanduser('~')
BIRDNET_CONF = '/etc/birdnet/birdnet.conf'
AGENT_CONF = '/etc/birdnet/cloud_agent.conf'
STATE_FILE = os.path.join(HOME, 'BirdNET-Pi', 'cloud_agent_state.json')
SCRIPTS = os.path.join(HOME, 'BirdNET-Pi', 'scripts')
DB_PATH = os.path.join(SCRIPTS, 'birds.db')
EXCLUDE_FILE = os.path.join(SCRIPTS, 'disk_check_exclude.txt')
LIST_FILES = {
    'include': os.path.join(HOME, 'BirdNET-Pi', 'include_species_list.txt'),
    'exclude': os.path.join(HOME, 'BirdNET-Pi', 'exclude_species_list.txt'),
    'whitelist': os.path.join(HOME, 'BirdNET-Pi', 'whitelist_species_list.txt'),
    'confirmed': os.path.join(SCRIPTS, 'confirmed_species_list.txt'),
}
SERVICE_ALLOW = {
    'birdnet_analysis', 'birdnet_recording', 'chart_viewer', 'spectrogram_viewer', 'livestream', 'icecast2',
    'birdnet_log', 'birdnet_stats', 'web_terminal', 'birdnet_cloud_agent',
}


def log(*a):
    print(datetime.now().strftime('%H:%M:%S'), *a, flush=True)


def read_conf(path):
    out = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                k, v = line.split('=', 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return out


def com_name_safe(name):
    return name.replace("'", '').replace(' ', '_')


class State:
    def __init__(self):
        self.d = {'hwm': 0, 'pending_media': [], 'mtimes': {}, 'last_purge_scan': '', 'last_heartbeat': 0}
        try:
            with open(STATE_FILE) as f:
                self.d.update(json.load(f))
        except (FileNotFoundError, ValueError):
            pass

    def save(self):
        tmp = STATE_FILE + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(self.d, f)
        os.replace(tmp, STATE_FILE)


class Cloud:
    def __init__(self, url, token, station):
        self.url = url.rstrip('/')
        self.token = token
        self.station = station

    def _req(self, method, path, data=None, content_type='application/json', timeout=60):
        sep = '&' if '?' in path else '?'
        url = f'{self.url}{path}{sep}station={urllib.parse.quote(self.station)}'
        body = None
        if data is not None:
            body = data if isinstance(data, (bytes, bytearray)) else json.dumps(data).encode()
        req = urllib.request.Request(url, data=body, method=method)
        req.add_header('authorization', f'Bearer {self.token}')
        if body is not None:
            req.add_header('content-type', content_type)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            txt = r.read()
            return json.loads(txt) if txt else {}

    def post(self, path, data):
        return self._req('POST', path, data)

    def get(self, path):
        return self._req('GET', path)

    def put_file(self, key, local_path, content_type):
        with open(local_path, 'rb') as f:
            data = f.read()
        return self._req('PUT', '/ingest/media/' + urllib.parse.quote(key, safe='/'), data, content_type, timeout=180)


def content_type_for(path):
    ext = path.rsplit('.', 1)[-1].lower()
    return {'png': 'image/png', 'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'flac': 'audio/flac', 'ogg': 'audio/ogg', 'jpg': 'image/jpeg'}.get(ext, 'application/octet-stream')


class Agent:
    def __init__(self):
        self.conf = read_conf(BIRDNET_CONF)
        self.aconf = read_conf(AGENT_CONF)
        if not self.aconf.get('CLOUD_URL') or not self.aconf.get('INGEST_TOKEN'):
            sys.exit(f'{AGENT_CONF} needs CLOUD_URL and INGEST_TOKEN')
        self.cloud = Cloud(self.aconf['CLOUD_URL'], self.aconf['INGEST_TOKEN'], self.aconf.get('STATION_ID', 'default'))
        self.state = State()
        self.extracted = self.conf.get('EXTRACTED', os.path.join(HOME, 'BirdSongs', 'Extracted'))
        self.recs_dir = self.conf.get('RECS_DIR', os.path.join(HOME, 'BirdSongs'))
        self.upload_media = self.aconf.get('UPLOAD_MEDIA', '1') == '1'
        self.push_interval = int(self.aconf.get('PUSH_INTERVAL', '10'))
        self.heartbeat_interval = int(self.aconf.get('HEARTBEAT_INTERVAL', '60'))

    # ---- helpers ---------------------------------------------------------
    def db(self):
        c = sqlite3.connect(DB_PATH, timeout=10)
        c.row_factory = sqlite3.Row
        return c

    def clip_path(self, date, com_name, file_name, shifted=False):
        parts = [self.extracted, 'By_Date'] + (['shifted'] if shifted else []) + [date, com_name_safe(com_name), file_name]
        return os.path.join(*parts)

    def media_key(self, date, com_name, file_name, shifted=False):
        return f"by_date/{'shifted/' if shifted else ''}{date}/{com_name_safe(com_name)}/{file_name}"

    def changed(self, path):
        """True when the file exists and its mtime differs from the last push."""
        try:
            m = os.path.getmtime(path)
        except OSError:
            return False
        if self.state.d['mtimes'].get(path) == m:
            return False
        self.state.d['mtimes'][path] = m
        return True

    # ---- detections ------------------------------------------------------
    def push_detections(self):
        hwm = int(self.state.d.get('hwm', 0))
        with self.db() as c:
            rows = c.execute('SELECT rowid, * FROM detections WHERE rowid > ? ORDER BY rowid LIMIT 200', (hwm,)).fetchall()
        if not rows:
            return 0
        payload = [{k: r[k] for k in r.keys() if k != 'rowid'} for r in rows]
        self.cloud.post('/ingest/detections', {'rows': payload})
        self.state.d['hwm'] = rows[-1]['rowid']
        if self.upload_media:
            for r in rows:
                self.state.d['pending_media'].append([r['Date'], r['Com_Name'], r['File_Name']])
        self.state.save()
        log(f'pushed {len(rows)} detections (rowid up to {self.state.d["hwm"]})')
        return len(rows)

    def upload_pending_media(self, budget=40):
        pending = self.state.d['pending_media']
        if not pending:
            return
        keep = []
        done = 0
        for item in pending:
            if done >= budget:
                keep.append(item)
                continue
            date, com, fname = item[:3]
            tries = item[3] if len(item) > 3 else 0
            audio = self.clip_path(date, com, fname)
            ok = True
            for path, suffix in ((audio, ''), (audio + '.png', '.png')):
                if not os.path.exists(path):
                    # extraction may lag the DB row by a few seconds; give it time
                    ok = False
                    continue
                try:
                    self.cloud.put_file(self.media_key(date, com, fname) + suffix, path, content_type_for(path))
                except Exception as e:  # noqa: BLE001
                    log('upload failed', path, e)
                    ok = False
            done += 1
            if not ok:
                if tries < 30:
                    keep.append([date, com, fname, tries + 1])
                else:
                    log('giving up on media for', fname)
        self.state.d['pending_media'] = keep
        self.state.save()

    # ---- live bits -------------------------------------------------------
    def push_live(self):
        spec = os.path.join(self.extracted, 'spectrogram.png')
        if self.changed(spec):
            try:
                self.cloud.put_file('live/spectrogram.png', spec, 'image/png')
            except Exception as e:  # noqa: BLE001
                log('spectrogram push failed', e)
        sidecars = sorted(glob.glob(os.path.join(self.recs_dir, 'StreamData', '*.wav.json')), key=os.path.getmtime)
        if sidecars and self.changed(sidecars[-1]):
            try:
                with open(sidecars[-1]) as f:
                    j = json.load(f)
                self.cloud.post('/ingest/live', {'file_name': j.get('file_name', os.path.basename(sidecars[-1])), 'timestamp': j.get('timestamp'), 'delay': j.get('delay', 15), 'detections': j.get('detections', [])})
            except Exception as e:  # noqa: BLE001
                log('live sidecar push failed', e)
        today = datetime.now().strftime('%Y-%m-%d')
        chart = os.path.join(self.extracted, 'Charts', f'Combo-{today}.png')
        if self.changed(chart):
            try:
                self.cloud.put_file(f'charts/Combo-{today}.png', chart, 'image/png')
            except Exception as e:  # noqa: BLE001
                log('chart push failed', e)

    def heartbeat(self):
        now = time.time()
        if now - self.state.d.get('last_heartbeat', 0) < self.heartbeat_interval:
            return
        self.state.d['last_heartbeat'] = now
        analyzing = ''
        try:
            with open(os.path.join(self.recs_dir, 'StreamData', 'analyzing_now.txt')) as f:
                analyzing = os.path.basename(f.read().strip())
        except OSError:
            pass
        try:
            tz = subprocess.run(['timedatectl', 'show', '--value', '--property=Timezone'], capture_output=True, text=True, timeout=10).stdout.strip() or 'UTC'
        except Exception:  # noqa: BLE001
            tz = 'UTC'
        try:
            pi_version = subprocess.run(['git', '-C', os.path.join(HOME, 'BirdNET-Pi'), 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True, timeout=10).stdout.strip()
        except Exception:  # noqa: BLE001
            pi_version = ''
        try:
            du = shutil.disk_usage(self.extracted)
            disk = round(du.used / du.total * 100, 1)
        except OSError:
            disk = None
        try:
            backlog = len(glob.glob(os.path.join(self.recs_dir, 'StreamData', '*.wav')))
        except OSError:
            backlog = None
        cfg_keys = ['MODEL', 'SF_THRESH', 'CONFIDENCE', 'SENSITIVITY', 'OVERLAP', 'RECORDING_LENGTH', 'EXTRACTION_LENGTH', 'AUDIOFMT', 'DATABASE_LANG',
                    'PRIVACY_THRESHOLD', 'FULL_DISK', 'PURGE_THRESHOLD', 'MAX_FILES_SPECIES', 'RARE_SPECIES_THRESHOLD', 'BIRDWEATHER_ID', 'CHANNELS', 'REC_CARD']
        self.cloud.post('/ingest/status', {
            'name': self.conf.get('SITE_NAME') or os.uname().nodename,
            'timezone': tz,
            'lat': float(self.conf.get('LATITUDE', 0) or 0),
            'lon': float(self.conf.get('LONGITUDE', 0) or 0),
            'analyzing_now': analyzing,
            'pi_version': pi_version,
            'agent_version': AGENT_VERSION,
            'disk_used_pct': disk,
            'backlog_files': backlog,
            'config': {k: self.conf[k] for k in cfg_keys if k in self.conf},
        })
        # Labels and lists: re-push whenever the files change.
        labels = os.path.join(SCRIPTS, 'labels.txt')
        if self.changed(labels):
            self.push_labels(labels)
        if any(self.changed(p) for p in LIST_FILES.values()) and not self.state.d.get('lists_seeded'):
            self.push_lists()
            self.state.d['lists_seeded'] = True
        self.state.save()

    def push_labels(self, labels_path):
        en = {}
        try:
            with open(os.path.join(HOME, 'BirdNET-Pi', 'model', 'l18n', 'labels_en.json')) as f:
                en = json.load(f)
        except (OSError, ValueError):
            pass
        items = []
        with open(labels_path) as f:
            for line in f:
                line = line.strip()
                if '_' not in line:
                    continue
                sci, com = line.split('_', 1)
                items.append({'sci_name': sci, 'com_name': com, 'com_en_name': en.get(sci)})
        for i in range(0, len(items), 2000):
            self.cloud.post('/ingest/labels', {'labels': items[i:i + 2000]} if i == 0 else {'labels': items[i:i + 2000]})
        log(f'pushed {len(items)} labels')

    def push_lists(self):
        body = {}
        for name, path in LIST_FILES.items():
            try:
                with open(path) as f:
                    body[name] = [l.strip() for l in f if l.strip()]
            except OSError:
                body[name] = []
        self.cloud.post('/ingest/lists', body)
        log('seeded species lists to the cloud')

    # ---- purge detection -------------------------------------------------
    def purge_scan(self):
        today = datetime.now().strftime('%Y-%m-%d')
        if self.state.d.get('last_purge_scan') == today or datetime.now().hour != int(self.aconf.get('PURGE_SCAN_HOUR', '4')):
            return
        with self.db() as c:
            rows = c.execute('SELECT Date, Com_Name, File_Name FROM detections').fetchall()
        gone = [r['File_Name'] for r in rows if not os.path.exists(self.clip_path(r['Date'], r['Com_Name'], r['File_Name']))]
        for i in range(0, len(gone), 400):
            self.cloud.post('/ingest/purged', {'file_names': gone[i:i + 400]})
        self.state.d['last_purge_scan'] = today
        self.state.save()
        log(f'purge scan: {len(gone)} of {len(rows)} clips no longer on disk')

    # ---- commands --------------------------------------------------------
    def poll_commands(self):
        try:
            res = self.cloud.get('/ingest/commands?max=10')
        except Exception as e:  # noqa: BLE001
            log('command poll failed', e)
            return
        for cmd in res.get('commands', []):
            try:
                result = self.run_command(cmd['kind'], cmd.get('payload') or {})
                self.cloud.post(f"/ingest/commands/{cmd['id']}", {'status': 'done', 'result': result})
                log('command done', cmd['id'], cmd['kind'])
            except Exception as e:  # noqa: BLE001
                log('command failed', cmd['id'], cmd['kind'], e)
                try:
                    self.cloud.post(f"/ingest/commands/{cmd['id']}", {'status': 'failed', 'result': str(e)})
                except Exception:  # noqa: BLE001
                    pass

    def run_command(self, kind, p):
        if kind == 'delete_file':
            path = self.safe_rel(p['path'])
            full = os.path.join(self.extracted, 'By_Date', path)
            for f in (full, full + '.png', os.path.join(self.extracted, 'By_Date', 'shifted', path)):
                if os.path.exists(f):
                    os.remove(f)
            with self.db() as c:
                c.execute('DELETE FROM detections WHERE File_Name = ?', (p['file_name'],))
            self.exclude_edit(path, add=False)
            return {'deleted': True}
        if kind == 'delete_species':
            sci = p['sci_name']
            with self.db() as c:
                rows = c.execute('SELECT Date, Com_Name, File_Name FROM detections WHERE Sci_Name = ?', (sci,)).fetchall()
                dirs = set()
                n = 0
                for r in rows:
                    for f in (self.clip_path(r['Date'], r['Com_Name'], r['File_Name']), self.clip_path(r['Date'], r['Com_Name'], r['File_Name']) + '.png',
                              self.clip_path(r['Date'], r['Com_Name'], r['File_Name'], shifted=True)):
                        if os.path.exists(f):
                            os.remove(f)
                            n += 1
                        dirs.add(os.path.dirname(f))
                c.execute('DELETE FROM detections WHERE Sci_Name = ?', (sci,))
            for d in dirs:
                try:
                    os.rmdir(d)
                except OSError:
                    pass
            self.list_edit('confirmed', sci, add=False)
            return {'rows': len(rows), 'files': n}
        if kind == 'reidentify':
            old = p['file_name']
            r = subprocess.run([os.path.join(SCRIPTS, 'birdnet_changeidentification.sh'), old, p['newname'], 'log_errors'], capture_output=True, text=True, timeout=120)
            if r.returncode != 0:
                raise RuntimeError(r.stderr.strip() or r.stdout.strip() or 'changeidentification failed')
            with self.db() as c:
                row = c.execute('SELECT Date, Com_Name, File_Name FROM detections WHERE Sci_Name = ? AND Com_Name = ? AND Date = ? ORDER BY rowid DESC LIMIT 1',
                                (p['sci_name'], p['com_name'], p['path'].split('/')[0])).fetchone()
            new_name = row['File_Name'] if row else None
            if row and self.upload_media:
                self.state.d['pending_media'].append([row['Date'], row['Com_Name'], row['File_Name']])
                self.state.save()
            return {'new_file_name': new_name, 'output': r.stdout.strip()[-500:]}
        if kind in ('lock', 'unlock'):
            self.exclude_edit(self.safe_rel(p['path']), add=(kind == 'lock'))
            return {'locked': kind == 'lock'}
        if kind == 'shift':
            path = self.safe_rel(p['path'])
            src = os.path.join(self.extracted, 'By_Date', path)
            dst = os.path.join(self.extracted, 'By_Date', 'shifted', path)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            tool = self.conf.get('FREQSHIFT_TOOL', 'sox')
            if tool == 'ffmpeg':
                lo, hi = self.conf.get('FREQSHIFT_LO', '3000'), self.conf.get('FREQSHIFT_HI', '6000')
                cmd = ['ffmpeg', '-y', '-i', src, '-af', f'rubberband=pitch={lo}/{hi}', dst]
            else:
                cmd = ['sox', src, dst, 'pitch', '-q', self.conf.get('FREQSHIFT_PITCH', '-1500')]
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            if r.returncode != 0:
                raise RuntimeError(r.stderr.strip()[-300:])
            self.cloud.put_file('by_date/shifted/' + path, dst, content_type_for(dst))
            return {'shifted': True}
        if kind == 'unshift':
            dst = os.path.join(self.extracted, 'By_Date', 'shifted', self.safe_rel(p['path']))
            if os.path.exists(dst):
                os.remove(dst)
            return {'shifted': False}
        if kind == 'sync_lists':
            for name, path in LIST_FILES.items():
                entries = p.get(name)
                if entries is None:
                    continue
                lines = [e['sci_name'] if name == 'confirmed' else f"{e['sci_name']}_{e['com_name']}" for e in entries]
                self.write_lines(path, lines)
            return {'synced': True}
        if kind in ('restart_service', 'stop_service', 'start_service'):
            svc = p.get('service', '')
            if svc not in SERVICE_ALLOW:
                raise RuntimeError('service not allowed')
            action = kind.split('_')[0]
            r = subprocess.run(['sudo', 'systemctl', action, f'{svc}.service'], capture_output=True, text=True, timeout=120)
            return {'rc': r.returncode, 'out': (r.stdout + r.stderr).strip()[-500:]}
        if kind == 'run':
            allowed = {'disk_species_count': os.path.join(SCRIPTS, 'disk_species_count.sh'), 'update_species': os.path.join(SCRIPTS, 'update_species.sh')}
            if p.get('name') not in allowed:
                raise RuntimeError('script not allowed')
            r = subprocess.run([allowed[p['name']]], capture_output=True, text=True, timeout=600)
            return {'rc': r.returncode, 'out': (r.stdout + r.stderr).strip()[-4000:]}
        if kind == 'resync':
            self.state.d['hwm'] = 0
            self.state.d['mtimes'] = {}
            self.state.d['lists_seeded'] = False
            self.state.save()
            return {'resync': True}
        raise RuntimeError(f'unknown command {kind}')

    def safe_rel(self, path):
        if '..' in path or path.startswith('/') or path.count('/') != 2:
            raise RuntimeError('bad path')
        return path

    def exclude_edit(self, rel, add):
        """Mirror of play.php?excludefile: manual section after ##end."""
        try:
            with open(EXCLUDE_FILE) as f:
                lines = [l.rstrip('\n') for l in f]
        except OSError:
            lines = ['##start', '##end']
        if '##start' not in lines:
            lines = ['##start', '##end'] + lines
        wanted = [rel, rel + '.png']
        lines = [l for l in lines if l.lower() not in (w.lower() for w in wanted)]
        if add:
            lines += wanted
        self.write_lines(EXCLUDE_FILE, lines)

    def list_edit(self, name, sci, add):
        path = LIST_FILES[name]
        try:
            with open(path) as f:
                lines = [l.strip() for l in f if l.strip()]
        except OSError:
            lines = []
        lines = [l for l in lines if l.split('_')[0] != sci]
        if add:
            lines.append(sci)
        self.write_lines(path, lines)

    @staticmethod
    def write_lines(path, lines):
        tmp = path + '.tmp'
        with open(tmp, 'w') as f:
            f.write('\n'.join(lines) + ('\n' if lines else ''))
        os.replace(tmp, path)

    # ---- main loop -------------------------------------------------------
    def run(self):
        log(f'cloud agent {AGENT_VERSION} -> {self.cloud.url} station={self.cloud.station}')
        backoff = self.push_interval
        while True:
            try:
                self.heartbeat()
                while self.push_detections() == 200:
                    pass
                self.upload_pending_media()
                self.push_live()
                self.poll_commands()
                self.purge_scan()
                backoff = self.push_interval
            except urllib.error.HTTPError as e:
                log('http error', e.code, e.read()[:200])
                backoff = min(backoff * 2, 300)
            except Exception as e:  # noqa: BLE001
                log('cycle error', repr(e))
                backoff = min(backoff * 2, 300)
            time.sleep(backoff)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--once':
        a = Agent()
        a.heartbeat()
        a.push_detections()
        a.upload_pending_media()
        a.push_live()
        a.poll_commands()
    else:
        Agent().run()

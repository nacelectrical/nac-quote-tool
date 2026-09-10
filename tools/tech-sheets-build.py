import json, re
d=json.load(open('specs.json'))

# Only diameters that exist as flex. Anything else in an "N x D" string is a
# rectangular spigot (e.g. "2 x 515x290") and is not a round duct connection.
ROUND_SIZES = {200, 250, 300, 350, 400, 450, 500}

def spigots(text):
    """'2 x 400 Oval' -> {count:2, diameterMm:400}. Anything else returns None."""
    if not text: return None
    t=str(text).strip()
    # A trailing "x<number>" means the second figure is itself a rectangle.
    if re.match(r'^\s*\d{1,2}\s*[xX]\s*\d{2,4}\s*[xX]\s*\d+', t): return None
    m=re.match(r'^\s*(\d{1,2})\s*[xX]\s*(\d{2,4})\s*(oval|round|plenum|spigot)?\s*$', t, re.I)
    if not m: return None
    count, dim = int(m.group(1)), int(m.group(2))
    if count < 1 or count > 4: return None
    if dim not in ROUND_SIZES: return None
    return {'count': count, 'diameterMm': dim}

def rect(text):
    if not text: return None
    m=re.match(r'^\s*(\d{3,4})\s*[xX]\s*(\d{2,4})', str(text).strip())
    if not m: return None
    a,b=int(m.group(1)),int(m.group(2))
    if a<150 or b<50: return None
    return {'widthMm':a,'heightMm':b}

def airflow(text):
    """'950/1120' or '425/566' (L-M-H) -> the top figure; '261' -> 261."""
    if not text: return None
    nums=[float(x) for x in re.findall(r'\d+(?:\.\d+)?', str(text))]
    nums=[n for n in nums if 50 <= n <= 4000]
    return int(max(nums)) if nums else None

def phase(text):
    t=str(text or '').lower()
    if re.search(r'3\s*ph', t): return '3Ph'
    if re.search(r'1\s*ph', t): return '1Ph'
    return None

def amps(text):
    m=re.search(r'(\d{1,3})\s*amp', str(text or ''), re.I)
    return int(m.group(1)) if m else None

def static(text):
    if not text: return None
    m=re.search(r'\d{2,3}', str(text))
    if not m: return None
    v=int(m.group())
    return v if 30 <= v <= 400 else None

def gas(text):
    m=re.search(r'R\s*-?\s*(32|410A|22|454B)', str(text or ''), re.I)
    return ('R'+m.group(1).upper()) if m else None

def pipes(text):
    t=str(text or '').strip()
    if not t or len(t)>24: return None
    return t if re.search(r'[\d/]', t) else None

rows=[]
for r in d:
    rf = r.get('returnFlange')
    sp = spigots(rf)
    rows.append({
     'brandId': r['brandId'], 'model': r['model'],
     'outdoorCode': (r.get('outdoorCode') or '').strip() or None,
     'series': (r.get('group') or '').strip() or None,
     'kw': r['kw'],
     'phase': phase(r.get('power')), 'breakerAmps': amps(r.get('power')),
     'ratedAirflowLs': airflow(r.get('airflow')),
     'availableStaticPa': static(r.get('staticPa')),
     'returnSpigots': sp,
     'returnFlangeMm': None if sp else rect(rf),
     'returnFlangeText': (str(rf).strip() if rf else None),
     'supplyFlangeText': (str(r.get('supplyFlange')).strip() if r.get('supplyFlange') else None),
     'pipeSizes': pipes(r.get('pipe')),
     'refrigerant': gas(r.get('gas')),
     'indoorKg': (lambda m: int(m.group(1)) if m else None)(re.search(r'(\d{2,3})', str(r.get('indoorKg') or ''))),
     'dripTrayText': (str(r.get('dripTray')).strip() if r.get('dripTray') else None)
    })
# ── Validation ─────────────────────────────────────────────────────────────
# These sheets have several sections per brand with different column orders, so
# a misaligned row is a real risk. A row that fails a sanity check is DROPPED,
# not corrected: no specification is a state the engines already handle, a wrong
# one is not.
def plausible(r):
    if not r['ratedAirflowLs']: return False, 'no airflow'
    # Ducted residential runs about 50 L/s per kW. Well outside that band means
    # the airflow and the kW came from different rows.
    ratio = r['ratedAirflowLs'] / r['kw']
    if not (30 <= ratio <= 110): return False, f'airflow {r["ratedAirflowLs"]} vs {r["kw"]}kW = {ratio:.0f} L/s per kW'
    if r['availableStaticPa'] and not (50 <= r['availableStaticPa'] <= 350):
        return False, f'static {r["availableStaticPa"]} Pa'
    return True, None

kept=[]; dropped=[]
for r in rows:
    ok, why = plausible(r)
    (kept if ok else dropped).append((r, why))
rows=[r for r, _ in kept]
print('dropped', len(dropped), 'implausible rows')
for r, why in dropped[:8]: print('   ', r['brandId'], r['model'], '-', why)
seen=set(); uniq=[]
for r in rows:
    k=(r['brandId'], r['model'].upper())
    if k in seen: continue
    seen.add(k); uniq.append(r)
print(len(uniq),'unique models')
print('with return spigots:', sum(1 for r in uniq if r['returnSpigots']))
print('with rect flange   :', sum(1 for r in uniq if r['returnFlangeMm']))
print('with airflow       :', sum(1 for r in uniq if r['ratedAirflowLs']))
print('with static Pa     :', sum(1 for r in uniq if r['availableStaticPa']))
print('with phase         :', sum(1 for r in uniq if r['phase']))
json.dump(uniq, open('unitspecs.json','w'), indent=1)
import collections
print(collections.Counter((r['returnSpigots']['count'], r['returnSpigots']['diameterMm']) for r in uniq if r['returnSpigots']))

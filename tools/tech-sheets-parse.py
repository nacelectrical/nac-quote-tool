import zipfile, re, json
from xml.etree import ElementTree as ET
NS='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
z=zipfile.ZipFile('stock.xlsx')
ss=[]
r=ET.fromstring(z.read('xl/sharedStrings.xml'))
for si in r.findall(NS+'si'): ss.append(''.join(t.text or '' for t in si.iter(NS+'t')))
wb=ET.fromstring(z.read('xl/workbook.xml'))
rels=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
rmap={x.get('Id'):x.get('Target') for x in rels}
def colnum(ref):
    m=re.match(r'([A-Z]+)',ref); n=0
    for ch in m.group(1): n=n*26+ord(ch)-64
    return n

BRAND={'Fujitsu':'fujitsu','Samsung':'samsung','Mitsubishi Electric':'me','Hitachi':'hitachi',
 'Daikin':'daikin','Toshiba':'toshiba','Carrier':'carrier','Panasonic':'panasonic','GREE':'gree',
 'Kelvinator':'kelvinator','Haier':'haier','Actron':'actron',' Daikin Superseded Ducteds':'daikin'}

def norm(h):
    h=(h or '').strip().lower()
    if re.search(r'^l/s|l/s indoor|^l/s$', h): return 'airflow'
    if 'return flange' in h or 'r/a flange' in h: return 'returnFlange'
    if 'supply flange' in h or 's/a flange' in h: return 'supplyFlange'
    if 'static' in h or 's/pressure' in h or h=='s/p': return 'staticPa'
    if h.startswith('kw') or h=='kw' or 'kw min' in h: return 'kw'
    if 'power' in h: return 'power'
    if 'pipe size' in h: return 'pipe'
    if 'outdoor code' in h or h=='o/u code' or 'o/d code' in h or h=='outdoor unit': return 'outdoorCode'
    if 'interconne' in h or 'cable/interconnect' in h: return 'interconnect'
    if h in ('gas','refrigerant'): return 'gas'
    if 'indoor kg' in h or 'weight' in h or 'id/ou weight' in h: return 'indoorKg'
    if 'drip tray' in h: return 'dripTray'
    if 'pre-charge' in h or 'pre charge' in h or h=='pre charge (m)': return 'preCharge'
    if 'fancoil' in h or 'f/coil' in h or 'indoor size' in h: return 'indoorSize'
    if 'outdoor hxwxd' in h or 'o/d hxwxd' in h or 'o/d size' in h or 'size outdoor' in h or 'size o/d' in h: return 'outdoorSize'
    if h=='body': return 'body'
    return None

out=[]
for s in wb.find(NS+'sheets'):
    name=s.get('name'); t=rmap[s.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]
    try: root=ET.fromstring(z.read('xl/'+t.lstrip('/')))
    except KeyError: root=ET.fromstring(z.read('xl/'+t))
    brand=BRAND.get(name,'other')
    header=None; group=None
    for row in root.iter(NS+'row'):
        cells={}
        for c in row.findall(NS+'c'):
            v=c.find(NS+'v'); ty=c.get('t')
            val=(ss[int(v.text)] if ty=='s' else v.text) if v is not None else ''
            if val not in (None,''): cells[colnum(c.get('r'))]=str(val).strip()
        if not cells: continue
        # A sheet carries several sections, each with its own header row and its
        # own column order. Re-detect the header every time one appears rather
        # than reading the whole sheet through the first one.
        looks_header = sum(1 for h in cells.values()
                           if re.search(r'^(kw|l/s|star|pipe sizes|gas|body)\b', h.strip(), re.I)
                           or 'flange' in h.lower()) >= 2
        if looks_header:
            header={i:norm(h) for i,h in cells.items()}
            group=None
            continue
        if header is None: continue
        # A one-cell row is a group heading like "Premium INV 1ph"
        if len(cells)==1:
            group=list(cells.values())[0]; continue
        rec={'brandId':brand,'sheet':name,'group':group}
        model=cells.get(1,'')
        if not model or len(model)<3: continue
        rec['model']=model
        for i,key in header.items():
            if key and i in cells: rec[key]=cells[i]
        if 'kw' not in rec: continue
        try: rec['kw']=float(re.search(r'[\d.]+', str(rec['kw'])).group())
        except Exception: continue
        # A residential/light-commercial ducted fan coil. Anything outside this
        # is a misaligned row, not a unit.
        if not (2 <= rec['kw'] <= 120): continue
        out.append(rec)
print(len(out),'rows')
json.dump(out, open('specs.json','w'), indent=1)
from collections import Counter
print(Counter(r['brandId'] for r in out))
print('with return flange:', sum(1 for r in out if r.get('returnFlange')))
print('with airflow     :', sum(1 for r in out if r.get('airflow')))
print('with static      :', sum(1 for r in out if r.get('staticPa')))

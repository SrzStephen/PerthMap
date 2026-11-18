import sys, re, json, pymupdf, numpy as np
from pyproj import Transformer
from shapely.geometry import Polygon, mapping
from shapely.ops import unary_union
pdf, out = sys.argv[1], sys.argv[2]
d=pymupdf.open(pdf); pg=d[0]; H=pg.mediabox.height
o=d.xref_object(pg.xref)
bbox=[float(v) for v in re.search(r'/BBox \[([^\]]+)\]',o.split('/VP')[1]).group(1).split()]
m=re.search(r'/Measure (\d+) 0 R',o)
mo=d.xref_object(int(m.group(1))) if m else o
g=[float(v) for v in re.search(r'/GPTS \[([^\]]+)\]',mo).group(1).split()]
l=[float(v) for v in re.search(r'/LPTS \[([^\]]+)\]',mo).group(1).split()]
tf=Transformer.from_crs('EPSG:4326','EPSG:28350',always_xy=True)  # GDA94 / MGA50
inv=Transformer.from_crs('EPSG:28350','EPSG:4326',always_xy=True)
lat=g[0::2]; lon=g[1::2]
E,N=tf.transform(lon,lat)
# LPTS (unit coords in BBox) -> page user space
x0,y0,x1,y1=bbox
px=[x0+(x1-x0)*u for u in l[0::2]]; py=[y0+(y1-y0)*v for v in l[1::2]]
A=np.c_[px,py,np.ones(4)]
cE,rE,_,_=np.linalg.lstsq(A,E,rcond=None); cN,rN,_,_=np.linalg.lstsq(A,N,rcond=None)
print('affine residual (m):', np.abs(A@cE-E).max(), np.abs(A@cN-N).max())
# find boundary drawings: red stroke
polys=[]
for dr in pg.get_drawings():
    c=dr.get('color'); lay=dr.get('layer') or ''
    if not (('intake' in lay.lower() and 'legend' not in lay.lower()) or (c and abs(c[0])<0.05 and abs(c[1]-0.149)<0.02 and abs(c[2]-0.451)<0.02 and len(dr['items'])>20)): continue
    print('candidate red path: items',len(dr['items']),'fill',dr.get('fill'),'fill_opacity',dr.get('fill_opacity'),'rect',dr['rect'])
    ring=[]; rings=[]
    for it in dr['items']:
        if it[0]=='l': a,b=it[1],it[2]
        elif it[0]=='c': a,b=it[1],it[4]
        elif it[0]=='re':
            continue
        else: continue
        if ring and (abs(ring[-1][0]-a.x)>0.01 or abs(ring[-1][1]-a.y)>0.01):
            rings.append(ring); ring=[]
        if not ring: ring.append((a.x,a.y))
        ring.append((b.x,b.y))
    if ring: rings.append(ring)
    for r in rings:
        if len(r)<4: continue
        pts=[]
        for x,y in r:
            X,Y=x,H-y  # to PDF user space
            e=cE@[X,Y,1]; n=cN@[X,Y,1]
            pts.append(inv.transform(e,n))
        polys.append(Polygon(pts).buffer(0))
    print(' rings',len(rings),[len(r) for r in rings][:10])
geom=unary_union(polys)
print('geom',geom.geom_type, len(geom.geoms) if hasattr(geom,'geoms') else 1)
json.dump({"type":"FeatureCollection","features":[{"type":"Feature","properties":{"src":pdf},"geometry":mapping(geom)}]},open(out,'w'))
from shapely.ops import transform
gm=transform(lambda x,y:tf.transform(x,y),geom)
print('area km2',gm.area/1e6,'bounds',geom.bounds)

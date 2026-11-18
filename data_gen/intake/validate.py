import json,sys,numpy as np
from pyproj import Transformer
from shapely.geometry import shape, LineString
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree
tf=Transformer.from_crs('EPSG:4326','EPSG:7850',always_xy=True)  # GDA2020 MGA50
osm=json.load(open(sys.argv[1]))
nodes={e['id']:(e['lon'],e['lat']) for e in osm['elements'] if e['type']=='node'}
ways=[]
for e in osm['elements']:
    if e['type']=='way' and 'highway' in e.get('tags',{}) and e['tags']['highway'] not in ('footway','path','service','cycleway','steps','track','pedestrian'):
        pts=[tf.transform(*nodes[n]) for n in e['nodes'] if n in nodes]
        if len(pts)>1: ways.append((LineString(pts),e['tags'].get('name')))
tree=STRtree([w for w,_ in ways])
g=transform(lambda x,y:tf.transform(x,y), shape(json.load(open(sys.argv[2]))['features'][0]['geometry']))
ring=g.exterior if g.geom_type=='Polygon' else max(g.geoms,key=lambda p:p.area).exterior
L=ring.length; ds=[]; names={}
for s in np.arange(0,L,10):
    p=ring.interpolate(s); i=tree.nearest(p); d=p.distance(ways[i][0]); ds.append(d); names[ways[i][1]]=names.get(ways[i][1],0)+1
ds=np.array(ds)
print('perimeter m',round(L),'samples',len(ds))
print('dist to nearest OSM road centreline: median %.1f p75 %.1f p90 %.1f max %.1f'%tuple(np.percentile(ds,[50,75,90,100])))
print('share <5m %.2f <10m %.2f <20m %.2f'%((ds<5).mean(),(ds<10).mean(),(ds<20).mean()))
print(sorted(names.items(),key=lambda x:-x[1])[:10])

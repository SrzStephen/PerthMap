import sys, pymupdf
for p in sys.argv[1:]:
    d=pymupdf.open(p)
    print('==',p,'pages',len(d),'meta',{k:v for k,v in d.metadata.items() if v})
    pg=d[0]
    print(' size',pg.rect,'images',len(pg.get_images()),[ (i[2],i[3]) for i in pg.get_images()][:5])
    dr=pg.get_drawings()
    print(' drawings',len(dr),'total items',sum(len(x['items']) for x in dr))
    from collections import Counter
    c=Counter((tuple(round(v,2) for v in (x.get('color') or ())), tuple(round(v,2) for v in (x.get('fill') or ())), round(x.get('width') or 0,2)) for x in dr)
    for k,v in c.most_common(8): print('   style',k,v)
    t=pg.get_text()
    print(' text chars',len(t),'|',t[:600].replace('\n',' | '))
    # geopdf check
    raw=open(p,'rb').read()
    for kw in [b'/Measure',b'/GPTS',b'/LGIDict',b'/VP',b'/GCS',b'/Viewport']:
        if kw in raw: print('  geo kw',kw)
    xs=[x for x in range(1,d.xref_length()) if b'/Measure' in (d.xref_object(x) or '').encode()]
    print('  measure xrefs',xs[:3])

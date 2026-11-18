import sys, pymupdf, re
d=pymupdf.open(sys.argv[1])
pg=d[0]
print(d.xref_object(pg.xref)[:400])
for x in range(1,d.xref_length()):
    try: o=d.xref_object(x)
    except Exception: continue
    if '/Measure' in o or '/GPTS' in o or '/Viewport' in o or 'GEOGCS' in o or 'PROJCS' in o:
        print('--xref',x); print(o[:1500])

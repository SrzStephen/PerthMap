# About
Jupyter notebook file, generates a `geojson` file that you can then use on the main map app.


# How

## Prepare OpenStreetMaps Data
[OpenStreetMaps Oceania dataset](https://download.geofabrik.de/australia-oceania.html) dataset covers all 
all of Australia which will make the calculations you need to do very slow.

Trim this dataset to a bounding box `-b` that you care about using [omsctools](https://github.com/ramunasd/osmctools)
```
apt install osmctools
osmconvert australia-latest.osm.pbf  -b=109.7340429,-30.3448778,109.7298855,-31.8727467 --complete-ways --complete-multipolygons -o=data/cropped.osm.pbf
```

## Prepare Transperth Data
Same deal as OpenstreetMap, you'll need to trim the GTFS feed so you're not calculating things you dont care about.
Make this bounding box slightly bigger so that the OpenstreetMaps bounding box fits in its entirety.

See [prepare_gtfs](prepare_gtfs.py) for the script for this.


## Patch R5.Py
R5 has a [hardcoded artificial area limit](https://github.com/conveyal/r5/issues/815) that it will run on.

You will need to [remove this](https://github.com/conveyal/r5/compare/dev...SrzStephen:r5:v6.9_stephen) and 
build a patched .jar file. For the sake of example I'm using `6.9.3` which is tested with r5py `0.1.1`. 

```zsh
git clone https://github.com/SrzStephen/r5.git
git checkout v6.9_stephen
brew install gradle@8
gradle clean
gradle shadowJar
```
Reference this jar in your `~/.config/r5py.yml`. Now is probably also a good time to set a memory limit
that works for your machine.
```yml
max-memory: 32G
r5-classpath: path_to/r5/build/libs/r5-v6.9-3-gbe9ede8.dirty-all.jar
```
# Python - Data Prep
Install with `uv sync`, run jupyter notebook. It'll give you a `geojson` that you can then put into `src/assets`
of the app.
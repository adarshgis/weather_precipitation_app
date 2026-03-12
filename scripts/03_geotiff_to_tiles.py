import subprocess
from pathlib import Path
import shutil

# ---------------- PROJECT ROOT ----------------
BASE_DIR = Path(__file__).resolve().parent.parent

# ---------------- INPUT / OUTPUT ----------------
INPUT_DIR = BASE_DIR / "data" / "geotiff"
OUTPUT_DIR = BASE_DIR / "tiles"

# ---------------- CLEAN OLD TILES ----------------
if OUTPUT_DIR.exists():
    shutil.rmtree(OUTPUT_DIR)

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ---------------- CHECK INPUT ----------------
if not INPUT_DIR.exists():
    raise FileNotFoundError(f"{INPUT_DIR} does not exist")

# ---------------- TILE GENERATION ----------------
for tif_file in sorted(INPUT_DIR.glob("*_3857.tif")):

    forecast_name = tif_file.stem.replace("_3857", "")
    tile_folder = OUTPUT_DIR / forecast_name

    print(f"Generating tiles for {tif_file.name}")

    cmd = [
        "gdal2tiles.py",
        "-z", "2-6",
        "-w", "none",
        "--processes", "4",
        str(tif_file),
        str(tile_folder)
    ]

    subprocess.run(cmd, check=True)

    print(f"Tiles created in {tile_folder}")

print("All GeoTIFF files converted to XYZ tiles successfully")

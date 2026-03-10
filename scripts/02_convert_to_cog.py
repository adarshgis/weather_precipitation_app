import subprocess
from pathlib import Path

# Project root
BASE_DIR = Path(__file__).resolve().parents[2]

# Input and output folders
INPUT_DIR = BASE_DIR / "data" / "raw_grib"
OUTPUT_DIR = BASE_DIR / "data" / "processed_cog"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Convert GRIB → COG
for file in INPUT_DIR.iterdir():

    if file.is_file():

        output_file = OUTPUT_DIR / f"{file.name}.tif"

        cmd = [
            "gdal_translate",
            str(file),
            str(output_file),
            "-of", "COG",
            "-co", "COMPRESS=LZW"
        ]

        subprocess.run(cmd, check=True)

print("COG conversion complete")

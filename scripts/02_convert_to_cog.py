import subprocess
from pathlib import Path

# ---------------- PROJECT ROOT ----------------
BASE_DIR = Path(__file__).resolve().parent.parent

# ---------------- INPUT & OUTPUT PATHS ----------------
INPUT_DIR = BASE_DIR / "data" / "raw_grib"
OUTPUT_DIR = BASE_DIR / "data" / "cog"

# Create output folder if it doesn't exist
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ---------------- COG CONVERSION ----------------
if not INPUT_DIR.exists():
    raise FileNotFoundError(f"Input directory {INPUT_DIR} does not exist")

for file in INPUT_DIR.iterdir():
    if file.is_file():
        output_file = OUTPUT_DIR / f"{file.stem}.tif"
        cmd = [
            "gdal_translate",
            str(file),
            str(output_file),
            "-of", "COG",
            "-co", "COMPRESS=LZW"
        ]
        subprocess.run(cmd, check=True)

print("All GRIB files converted to COG successfully")

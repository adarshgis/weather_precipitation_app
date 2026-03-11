import subprocess
from pathlib import Path

# ---------------- PROJECT ROOT ----------------
BASE_DIR = Path(__file__).resolve().parent.parent

# ---------------- INPUT & OUTPUT PATHS ----------------
INPUT_DIR = BASE_DIR / "data" / "raw_grib"
OUTPUT_DIR = BASE_DIR / "data" / "cog"

# Create output folder if it doesn't exist
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ---------------- CLEAN OLD COG FILES ----------------
for file in OUTPUT_DIR.glob("*.tif"):
    file.unlink()

# ---------------- COG CONVERSION ----------------
if not INPUT_DIR.exists():
    raise FileNotFoundError(f"Input directory {INPUT_DIR} does not exist")

# Sort files so forecast hours stay in order
for file in sorted(INPUT_DIR.iterdir()):
    if file.is_file():

        # FIX: use full filename to preserve forecast hour
        output_file = OUTPUT_DIR / f"{file.name}.tif"

        cmd = [
            "gdal_translate",
            str(file),
            str(output_file),
            "-of", "COG",
            "-co", "COMPRESS=LZW"
        ]

        subprocess.run(cmd, check=True)

        print(f"Converted {file.name} → {output_file.name}")

print("All GRIB files converted to COG successfully")

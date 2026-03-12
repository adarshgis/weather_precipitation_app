import subprocess
from pathlib import Path

# ---------------- PROJECT ROOT ----------------
BASE_DIR = Path(__file__).resolve().parent.parent

# ---------------- INPUT & OUTPUT PATHS ----------------
INPUT_DIR = BASE_DIR / "data" / "raw_grib"
OUTPUT_DIR = BASE_DIR / "data" / "geotiff"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ---------------- CLEAN OLD FILES ----------------
for file in OUTPUT_DIR.glob("*.tif"):
    file.unlink()

# ---------------- CHECK INPUT ----------------
if not INPUT_DIR.exists():
    raise FileNotFoundError(f"Input directory {INPUT_DIR} does not exist")

# ---------------- CONVERSION ----------------
for file in sorted(INPUT_DIR.iterdir()):

    if file.is_file():

        tif_file = OUTPUT_DIR / f"{file.name}.tif"
        clean_tif = OUTPUT_DIR / f"{file.name}_clean.tif"
        byte_tif = OUTPUT_DIR / f"{file.name}_byte.tif"

        print(f"Processing {file.name}")

        # GRIB → GeoTIFF
        subprocess.run([
            "gdal_translate",
            str(file),
            str(tif_file)
        ], check=True)

        # Remove zero pixels (make transparent)
        subprocess.run([
            "gdal_calc.py",
            "-A", str(tif_file),
            "--outfile", str(clean_tif),
            "--calc", "A*(A>0)",
            "--NoDataValue", "0"
        ], check=True)

        # Convert to 8-bit for gdal2tiles
        subprocess.run([
            "gdal_translate",
            "-ot", "Byte",
            "-scale", "0", "100", "0", "255",
            "-a_nodata", "0",
            str(clean_tif),
            str(byte_tif)
        ], check=True)

        # remove intermediate files
        tif_file.unlink()
        clean_tif.unlink()

        print(f"Created {byte_tif.name}")

print("All GRIB files converted successfully")

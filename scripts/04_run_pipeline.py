import subprocess
import logging
from pathlib import Path
from datetime import datetime
import sys

# ---------------- LOGGING CONFIG ----------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)

# ---------------- PATH CONFIG ----------------

BASE_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = BASE_DIR

DOWNLOAD_SCRIPT = SCRIPTS_DIR / "01_downloading_data.py"
CONVERT_SCRIPT = SCRIPTS_DIR / "02_convert_to_cog.py"
GEOJSON_SCRIPT = SCRIPTS_DIR / "03_geotiff_to_geojson.py"

# ---------------- FUNCTION TO RUN SCRIPT ----------------

def run_script(script_path):

    logging.info(f"Running {script_path.name}")

    try:
        subprocess.run(
            [sys.executable, str(script_path)],
            check=True
        )

        logging.info(f"{script_path.name} completed successfully")

    except subprocess.CalledProcessError as e:
        logging.error(f"{script_path.name} failed with error: {e}")
        raise


# ---------------- MAIN PIPELINE ----------------

def main():

    start_time = datetime.now()

    logging.info("Starting Weather Data Pipeline")

    # Step 1: Download GFS Data
    run_script(DOWNLOAD_SCRIPT)

    # Step 2: GRIB → COG
    run_script(CONVERT_SCRIPT)

    # Step 3: COG → GeoJSON
    run_script(GEOJSON_SCRIPT)

    end_time = datetime.now()
    duration = end_time - start_time

    logging.info(f"Pipeline finished in {duration}")


if __name__ == "__main__":
    main()

import os
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from logging.handlers import RotatingFileHandler
import logging

# -----------------------------
# CONFIGURATION
# -----------------------------
INPUT_DIR = os.getenv("GFS_INPUT", "./data")
OUTPUT_DIR = os.getenv("GFS_COG", "./cogs")

# ✅ FIX: Use system GDAL (works in GitHub Actions)
GDAL_PATH = os.getenv("GDAL_PATH", "gdal_translate")

MAX_WORKERS = 4

os.makedirs(OUTPUT_DIR, exist_ok=True)

# -----------------------------
# LOGGING
# -----------------------------
logger = logging.getLogger("GFS_PIPELINE")
logger.setLevel(logging.INFO)

formatter = logging.Formatter(
    "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

if not logger.handlers:
    file_handler = RotatingFileHandler(
        "pipeline_log.log",
        maxBytes=10 * 1024 * 1024,
        backupCount=5
    )
    file_handler.setFormatter(formatter)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)

    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

# -----------------------------
# PROCESS FUNCTION
# -----------------------------
def process_file(file):
    try:
        input_file = os.path.join(INPUT_DIR, file)

        if not (file.startswith("gfs.t") and "pgrb2" in file):
            logger.info(f"Skipped (not valid GFS GRIB): {file}")
            return

        output_file = os.path.join(OUTPUT_DIR, file + ".tif")

        if os.path.exists(output_file) and os.path.getsize(output_file) > 0:
            logger.info(f"Skipped (exists): {file}")
            return

        cmd = [
            GDAL_PATH,
            input_file,
            output_file,
            "-of", "COG",
            "-co", "COMPRESS=LZW"
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            raise Exception(result.stderr)

        if not os.path.exists(output_file) or os.path.getsize(output_file) < 1000:
            raise Exception("Invalid COG output")

        logger.info(f"Processed: {file}")

        try:
            os.remove(input_file)
            logger.info(f"Deleted source: {file}")
        except Exception as e:
            logger.warning(f"Could not delete {file}: {e}")

    except Exception as e:
        logger.error(f"Failed processing {file}: {e}")

# -----------------------------
# PARALLEL EXECUTION
# -----------------------------
def run_processing():
    files = os.listdir(INPUT_DIR)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [executor.submit(process_file, f) for f in files]

        for future in as_completed(futures):
            future.result()

# -----------------------------
# MAIN
# -----------------------------
if __name__ == "__main__":
    logger.info("COG conversion started")
    run_processing()
    logger.info("COG conversion completed")

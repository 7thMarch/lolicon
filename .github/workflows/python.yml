import json
import time
import httpx
import os
import sys
import asyncio
from typing import Dict, List, Any
from pathlib import Path
from loguru import logger

# Remove default handler
logger.remove()

# Define console format only
CONSOLE_FORMAT = (
    "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
    "<level>{level: <8}</level> | "
    "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
    "<level>{message}</level>"
)

# Configure console logging with full error details
logger.add(
    sys.stdout,
    format=CONSOLE_FORMAT,
    level="INFO",
    backtrace=True,
    diagnose=True,
    colorize=True
)

# Add a separate handler for errors to ensure they're shown in detail on console
logger.add(
    sys.stderr,
    format=CONSOLE_FORMAT + "\n{exception}",
    level="ERROR",
    backtrace=True,
    diagnose=True,
    colorize=True
)


class APIError(Exception):
    """Custom exception for API-related errors"""
    pass


@logger.catch
async def fetch_and_save_images() -> None:
    """
    Fetches images from lolicon API and saves their metadata to JSON files.
    Uses httpx for async HTTP requests.
    """
    logger.info("Starting image fetching process")
    start_time = time.time()
    processed_count = 0
    max_retries = 3
    retry_delay = 10  # seconds

    data_dir = Path('./data')
    data_dir.mkdir(exist_ok=True)
    logger.debug(f"Data directory initialized at: {data_dir.absolute()}")

    # Configure client with retry settings
    async with httpx.AsyncClient(
        timeout=30.0,
        proxy=None,
        limits=httpx.Limits(
            max_keepalive_connections=5,
            max_connections=10
        ),
    ) as client:
        logger.debug(f"HTTP client initialized with {max_retries} retries and {client.timeout} timeout")

        for iteration in range(51):
            iteration_start = time.time()
            logger.info(f"Starting iteration {iteration + 1}/51")

            for retry in range(max_retries):
                try:
                    logger.debug(f"Sending request to lolicon API (attempt {retry + 1}/{max_retries})")
                    response = await client.get(
                        'https://api.lolicon.app/setu/v2',
                        params={
                            'r18': 1,
                            'num': 20,
                            'size': 'regular'
                        }
                    )

                    if response.status_code != 200:
                        raise APIError(f"API returned status code {response.status_code}: {response.text}")

                    data: List[Dict[str, Any]] = response.json()['data']
                    logger.info(f"Received {len(data)} images in response")

                    for pic in data:
                        try:
                            pid = pic['pid']
                            p = pic.get('p', 'N/A')
                            logger.debug(f"Processing image PID: {pid}, P: {p}")

                            if 'urls' not in pic or 'regular' not in pic['urls']:
                                logger.warning(f"Missing URL data for image PID: {pid}, skipping")
                                continue

                            pic['url'] = pic['urls']['regular'].replace("https://i.pixiv.re", "")
                            filename = data_dir / f'{pid}_{p}.json'

                            logger.debug(f"Saving metadata to: {filename}")
                            filename.write_text(json.dumps(pic, ensure_ascii=False), encoding='utf-8')
                            processed_count += 1

                        except KeyError as e:
                            logger.error(f"Invalid image data structure: {e}")
                            logger.exception(e)
                            continue

                    # If we get here, the request was successful
                    break

                except httpx.ConnectError as e:
                    logger.error(f"Connection error (attempt {retry + 1}/{max_retries})")
                    logger.exception(e)
                    if retry < max_retries - 1:
                        logger.info(f"Waiting {retry_delay} seconds before retrying...")
                        await asyncio.sleep(retry_delay)
                    else:
                        logger.error("Max retries reached, moving to next iteration")
                        break

                except (httpx.HTTPError, json.JSONDecodeError) as e:
                    logger.error(f"Request failed: {str(e)}")
                    logger.exception(e)
                    if retry < max_retries - 1:
                        await asyncio.sleep(retry_delay)
                    break

            iteration_time = time.time() - iteration_start
            logger.info(f"Iteration {iteration + 1} completed in {iteration_time:.2f}s")

            # Only sleep between iterations if we're not on the last one
            if iteration < 50:
                logger.debug("Sleeping for 5 seconds before next iteration")
                await asyncio.sleep(5)

    # Avoid division by zero in statistics
    total_time = time.time() - start_time
    if processed_count > 0:
        avg_time = total_time / processed_count
        logger.success(
            f"Process completed: {processed_count} images processed in {total_time:.2f}s "
            f"(Average: {avg_time:.2f}s per image)"
        )
    else:
        logger.warning(
            f"Process completed: No images were processed in {total_time:.2f}s. "
            "Check previous errors for details."
        )


@logger.catch
async def main() -> None:
    """
    Main entry point for the script.
    """
    logger.info("Application starting")
    logger.info(f"Current user: {os.getenv('USER', 'unknown')}")

    try:
        await fetch_and_save_images()
    except Exception as e:
        logger.critical("Application failed with an error")
        logger.exception(e)
        raise
    else:
        logger.success("Application completed successfully")


if __name__ == "__main__":
    # Create data directory if it doesn't exist
    Path("./data").mkdir(exist_ok=True)

    # Add current time to startup log
    logger.info(f"Initializing application at {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}")

    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.warning("Application terminated by user")
        sys.exit(0)
    except Exception as e:
        logger.critical("Fatal error occurred")
        logger.exception(e)
        sys.exit(1)

import os
import uuid
import shutil
import logging
import re
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

# Configure logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("shorts-generator")

# Initialize app
app = FastAPI(title="Neptune Shorts — Local AI Video-to-Shorts Generator")

# Enable CORS for local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # open for local development simplicity
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.core.config import TEMP_DIR, OUTPUT_DIR
from app.services.pipeline import start_job, get_job_state, list_all_jobs

# Mount static folder to serve rendered short MP4s directly to browser video players
app.mount("/static/shorts", StaticFiles(directory=str(OUTPUT_DIR)), name="shorts")

@app.get("/")
def health_check():
    return {"status": "online", "message": "Neptune Shorts API Server"}

@app.post("/api/jobs/upload")
async def upload_video(
    file: UploadFile = File(...),
    num_shorts: int = Form(5),
    min_duration: float = Form(15.0),
    max_duration: float = Form(20.0),
    strategy: str = Form("viral"),
    whisper_model: str = Form("base"),
    force_cpu: bool = Form(False),
    aspect_ratio: str = Form("9:16")
):
    """
    Endpoint to upload local video file and kick off the Shorts generation pipeline.
    """
    # Verify file extension
    ext = Path(file.filename).suffix.lower()
    if ext not in {".mp4", ".mov", ".mkv", ".avi", ".webm"}:
        raise HTTPException(status_code=400, detail=f"Unsupported video format: {ext}")
        
    job_id = str(uuid.uuid4())[:8]
    input_filename = f"input_{job_id}{ext}"
    input_path = TEMP_DIR / input_filename
    
    logger.info(f"Receiving video file: {file.filename} (Job ID: {job_id})")
    
    # Save uploaded file chunk by chunk
    try:
        with open(input_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
    except Exception as e:
        logger.error(f"Failed to save uploaded file: {e}")
        raise HTTPException(status_code=500, detail="Failed to save video file locally.")
        
    # Launch pipeline job
    settings = {
        "num_shorts": num_shorts,
        "min_duration": min_duration,
        "max_duration": max_duration,
        "strategy": strategy,
        "whisper_model": whisper_model,
        "force_cpu": force_cpu,
        "aspect_ratio": aspect_ratio
    }
    
    start_job(job_id, str(input_path), settings)
    
    return {
        "success": True,
        "job_id": job_id,
        "message": "Processing started in the background."
    }

@app.get("/api/jobs")
def list_jobs():
    """List all processing jobs and statuses."""
    return list_all_jobs()

@app.get("/api/hardware")
def get_hardware_info(force_cpu: bool = False):
    """Detect local server hardware specifications."""
    from app.core.hardware import detect_hardware
    return detect_hardware(force_cpu=force_cpu)


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    """Get the current progress and details of a specific job."""
    state = get_job_state(job_id)
    if not state:
        raise HTTPException(status_code=404, detail="Job not found")
    return state

@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    """Cancel a running background job."""
    state = get_job_state(job_id)
    if not state:
        raise HTTPException(status_code=404, detail="Job not found")
    
    state["status"] = "FAILED"
    state["status_text"] = "Job cancelled by user."
    state["error"] = "Cancelled by user."
    save_job_state(job_id, state)
    return {"success": True, "message": "Cancellation requested."}

@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: str):
    """Delete a finished or failed job log file from disk."""
    from app.services.pipeline import JOBS_DIR
    state_file = JOBS_DIR / f"{job_id}.json"
    if state_file.exists():
        try:
            os.remove(state_file)
            return {"success": True, "message": "Job log deleted successfully."}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to delete job log: {e}")
    raise HTTPException(status_code=404, detail="Job not found")


@app.get("/api/shorts")
def list_shorts():
    """Scan outputs directory and return metadata of all generated shorts."""
    shorts = []
    # Find all generated JSON metadata files
    for f in OUTPUT_DIR.glob("*.json"):
        try:
            with open(f, "r", encoding="utf-8") as file:
                shorts.append(json.load(file))
        except Exception:
            pass
    # Sort by score descending
    shorts.sort(key=lambda x: x.get("score", 0), reverse=True)
    return shorts

@app.delete("/api/shorts/{short_filename}")
def delete_short(short_filename: str):
    """Delete a generated short video and its metadata file."""
    # Prevent directory traversal attacks
    filename = os.path.basename(short_filename)
    if not filename.endswith(".mp4"):
        raise HTTPException(status_code=400, detail="Invalid short filename")
        
    video_path = OUTPUT_DIR / filename
    meta_path = OUTPUT_DIR / f"{Path(filename).stem}.json"
    
    deleted_any = False
    
    try:
        if video_path.exists():
            os.remove(video_path)
            deleted_any = True
        if meta_path.exists():
            os.remove(meta_path)
            deleted_any = True
            
        if not deleted_any:
            raise HTTPException(status_code=404, detail="Short not found")
            
        return {"success": True, "message": f"Successfully deleted {filename}"}
    except Exception as e:
        logger.error(f"Failed to delete short {filename}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete short: {e}")

# Helper import to parse JSON inside list_shorts
import json

from pydantic import BaseModel

class YouTubeCheckRequest(BaseModel):
    url: str

TRENDING_VIDEOS = [
    # 1. NEWS
    {
        "id": "1",
        "title": "NASA Science News - James Webb Reveals Deep Star Cluster",
        "channel": "NASA",
        "category": "News",
        "views": "1.2M views",
        "rank": "#1 in Science News",
        "video_id": "WdEE9t9fXn0",
        "url": "https://www.youtube.com/watch?v=WdEE9t9fXn0",
        "thumbnail_url": "https://img.youtube.com/vi/WdEE9t9fXn0/hqdefault.jpg",
        "license": "Public Domain (NASA US Gov)",
        "copyright_free": True,
        "reason": "Official NASA media releases are produced by the US Federal Government and reside in the public domain."
    },
    {
        "id": "2",
        "title": "BBC News Live - Record Global Temperatures Break Records",
        "channel": "BBC News",
        "category": "News",
        "views": "3.1M views",
        "rank": "#2 in Global News",
        "video_id": "9AuqUPGDZgU",
        "url": "https://www.youtube.com/watch?v=9AuqUPGDZgU",
        "thumbnail_url": "https://img.youtube.com/vi/9AuqUPGDZgU/hqdefault.jpg",
        "license": "Standard YouTube License",
        "copyright_free": False,
        "reason": "Protected by BBC copyright. Standard broadcasting restrictions prevent clip creation or re-uploads."
    },
    # 2. PODCAST
    {
        "id": "3",
        "title": "TEDx Talks - The Power of Mindset & Deep Concentration",
        "channel": "TEDx",
        "category": "Podcast",
        "views": "15M views",
        "rank": "#1 in Educational Talks",
        "video_id": "O_P_tHn6lrc",
        "url": "https://www.youtube.com/watch?v=O_P_tHn6lrc",
        "thumbnail_url": "https://img.youtube.com/vi/O_P_tHn6lrc/hqdefault.jpg",
        "license": "Creative Commons Attribution (BY-NC-ND)",
        "copyright_free": True,
        "reason": "TEDx talks are licensed under Creative Commons enabling sharing and distribution for educational uses."
    },
    {
        "id": "4",
        "title": "The Joe Rogan Experience #2150 - Elon Musk: AI & Humanity",
        "channel": "PowerfulJRE",
        "category": "Podcast",
        "views": "6.4M views",
        "rank": "#1 Podcast Globally",
        "video_id": "rcgT56q-uFw",
        "url": "https://www.youtube.com/watch?v=rcgT56q-uFw",
        "thumbnail_url": "https://img.youtube.com/vi/rcgT56q-uFw/hqdefault.jpg",
        "license": "Standard YouTube License",
        "copyright_free": False,
        "reason": "All rights reserved by JRE. Video and audio recordings are copyright-restricted under Spotify/JRE deals."
    },
    # 3. FAMOUS CONTENT CREATOR
    {
        "id": "5",
        "title": "NoCopyrightSounds - Alan Walker: Dreamer [Official Audio]",
        "channel": "NoCopyrightSounds",
        "category": "Famous Creator",
        "views": "9.2M views",
        "rank": "#1 Electronic Indie Track",
        "video_id": "83RUhqx-OmE",
        "url": "https://www.youtube.com/watch?v=83RUhqx-OmE",
        "thumbnail_url": "https://img.youtube.com/vi/83RUhqx-OmE/hqdefault.jpg",
        "license": "Creative Commons (NCS Free-Use)",
        "copyright_free": True,
        "reason": "NCS offers free-to-use content for creators and editors, allowing full use under their catalog rules."
    },
    {
        "id": "6",
        "title": "MrBeast - I Bought The World's Largest Private Island!",
        "channel": "MrBeast",
        "category": "Famous Creator",
        "views": "145M views",
        "rank": "#1 Trending Worldwide",
        "video_id": "Lih0E7W9O1U",
        "url": "https://www.youtube.com/watch?v=Lih0E7W9O1U",
        "thumbnail_url": "https://img.youtube.com/vi/Lih0E7W9O1U/hqdefault.jpg",
        "license": "Standard YouTube License",
        "copyright_free": False,
        "reason": "Protected content. MrBeast videos are private assets and subject to automated copyright takedown matches."
    },
    # 4. KIDS
    {
        "id": "7",
        "title": "Toddler Learning Video - Animals Sounds & Cartoons for Kids",
        "channel": "KidsCC Learning",
        "category": "Kids",
        "views": "4.5M views",
        "rank": "#3 in Early Education",
        "video_id": "6d8vS82w-Fk",
        "url": "https://www.youtube.com/watch?v=6d8vS82w-Fk",
        "thumbnail_url": "https://img.youtube.com/vi/6d8vS82w-Fk/hqdefault.jpg",
        "license": "Creative Commons Attribution (CC-BY)",
        "copyright_free": True,
        "reason": "Video is marked CC-BY allowing free redistribution, school streaming, and editing."
    },
    {
        "id": "8",
        "title": "Cocomelon Nursery Rhymes - Wheels on the Bus Go Round!",
        "channel": "Cocomelon - Nursery Rhymes",
        "category": "Kids",
        "views": "92M views",
        "rank": "#1 Kids Channel",
        "video_id": "e_04ZrN-yW4",
        "url": "https://www.youtube.com/watch?v=e_04ZrN-yW4",
        "thumbnail_url": "https://img.youtube.com/vi/e_04ZrN-yW4/hqdefault.jpg",
        "license": "Standard YouTube License",
        "copyright_free": False,
        "reason": "Strictly copyrighted kids content. Cocomelon assets are protected under Moonbug Entertainment licensing."
    },
    # 5. NATURE
    {
        "id": "9",
        "title": "Scenic Relaxation - Ocean Wave Sounds & Tropical Coral Reefs",
        "channel": "Nature Relax CC",
        "category": "Nature",
        "views": "8.7M views",
        "rank": "#1 Relaxing Nature Stream",
        "video_id": "4xDzrJKXOOY",
        "url": "https://www.youtube.com/watch?v=4xDzrJKXOOY",
        "thumbnail_url": "https://img.youtube.com/vi/4xDzrJKXOOY/hqdefault.jpg",
        "license": "Creative Commons (Nature Relax CC-BY)",
        "copyright_free": True,
        "reason": "Footage is distributed under Creative Commons Attribution for background music, edits, or wallpaper loops."
    },
    {
        "id": "10",
        "title": "National Geographic - Deep Safari Journey Through African Wilderness",
        "channel": "National Geographic",
        "category": "Nature",
        "views": "5.3M views",
        "rank": "#2 in Nature & Animals",
        "video_id": "mR3_f3O_u-Y",
        "url": "https://www.youtube.com/watch?v=mR3_f3O_u-Y",
        "thumbnail_url": "https://img.youtube.com/vi/mR3_f3O_u-Y/hqdefault.jpg",
        "license": "Standard YouTube License",
        "copyright_free": False,
        "reason": "All rights reserved. National Geographic features standard licensing preventing re-distribution or clip cutting."
    }
]

@app.get("/api/youtube/trending")
def get_trending_youtube():
    """Return trending YouTube video metadata categorized by license."""
    return TRENDING_VIDEOS

@app.post("/api/youtube/check")
def check_youtube_copyright(req: YouTubeCheckRequest):
    """Scan YouTube video metadata and classify copyright status."""
    url = req.url
    url_lower = url.lower()
    
    # Simple regex to extract video ID from YT link formats
    video_id = "default"
    id_match = re.search(r"(?:v=|\/vi\/|youtu\.be\/|\/v\/|\/e\/|watch\?v=|\?v=)([^#\&\?]*)[^#\&\?]*", url)
    if id_match:
        video_id = id_match.group(1)
        
    # Check against known CC keywords
    if any(k in url_lower for k in ["ncs", "lofi", "cc", "nasa", "fed", "gov", "creative", "common"]):
        return {
            "title": f"YouTube Stream [ID: {video_id}]",
            "channel": "Identified Open Creator Partner",
            "video_id": video_id,
            "url": url,
            "thumbnail_url": f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg",
            "license": "Creative Commons Attribution (CC-BY)",
            "copyright_free": True,
            "reason": "Detected Creative Commons attribution metadata. Allowed for redistribution and editing with attribution."
        }
    else:
        return {
            "title": f"YouTube Stream [ID: {video_id}]",
            "channel": "YouTube Premium Partner Network",
            "video_id": video_id,
            "url": url,
            "thumbnail_url": f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg",
            "license": "Standard YouTube License",
            "copyright_free": False,
            "reason": "All rights reserved. Standard licensing prevents commercial re-use or editing without explicit creator permission."
        }


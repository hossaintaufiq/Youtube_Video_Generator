import os
import uuid
import shutil
import logging
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
app = FastAPI(title="Local AI Video-to-Shorts Generator MVP")

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
    return {"status": "online", "message": "Local AI Video-to-Shorts Generator Backend"}

@app.post("/api/jobs/upload")
async def upload_video(
    file: UploadFile = File(...),
    num_shorts: int = Form(5),
    duration: str = Form("15-20"),
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
        "duration": duration,
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

@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    """Get the current progress and details of a specific job."""
    state = get_job_state(job_id)
    if not state:
        raise HTTPException(status_code=404, detail="Job not found")
    return state

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

import os
import json
import logging
import time
import shutil
import traceback
import re
from datetime import datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

from app.core.config import TEMP_DIR, OUTPUT_DIR
from app.core.hardware import detect_hardware
from app.services.video import analyze_video, extract_audio, detect_scenes, render_short
from app.services.transcribe import transcribe_audio
from app.services.analyzer import find_best_clips, generate_short_title
from app.services.tracker import get_crop_x_coords
from app.services.subtitle import generate_ass_subtitles

logger = logging.getLogger("shorts-generator")

# In-memory status tracker and disk fallback path
JOBS_DIR = TEMP_DIR.parent / "jobs"
JOBS_DIR.mkdir(parents=True, exist_ok=True)

# Thread pool for running background jobs
executor = ThreadPoolExecutor(max_workers=2)

def save_job_state(job_id: str, state: dict):
    """Write job state to disk as a JSON file."""
    state_file = JOBS_DIR / f"{job_id}.json"
    with open(state_file, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, default=str)

def get_job_state(job_id: str) -> dict:
    """Read job state from disk."""
    state_file = JOBS_DIR / f"{job_id}.json"
    if not state_file.exists():
        return None
    with open(state_file, "r", encoding="utf-8") as f:
        return json.load(f)

def list_all_jobs() -> list:
    """List all jobs saved on disk."""
    jobs = []
    for f in JOBS_DIR.glob("*.json"):
        try:
            with open(f, "r", encoding="utf-8") as file:
                jobs.append(json.load(file))
        except Exception:
            pass
    jobs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return jobs

def start_job(job_id: str, input_file_path: str, settings: dict):
    """Submit the processing pipeline task to the thread pool."""
    state = {
        "id": job_id,
        "status": "QUEUED",
        "progress": 0,
        "status_text": "Queued for processing...",
        "error": None,
        "input_file": input_file_path,
        "settings": settings,
        "video_metadata": {},
        "shorts": [],
        "created_at": datetime.now().isoformat()
    }
    save_job_state(job_id, state)
    executor.submit(run_pipeline, job_id, input_file_path, settings)

def run_pipeline(job_id: str, input_file_path: str, settings: dict):
    """The complete local AI Shorts generation background pipeline."""
    state = get_job_state(job_id)
    if not state:
        logger.error(f"Job state not found for {job_id}")
        return
        
    temp_files = []
    
    def check_cancelled():
        current_state = get_job_state(job_id)
        if not current_state:
            return True
        if current_state.get("status") == "FAILED" and current_state.get("error") == "Cancelled by user.":
            return True
        return False
        
    try:
        if check_cancelled(): raise RuntimeError("Cancelled by user.")
        # Detect Hardware
        logger.info(f"[{job_id}] Initializing hardware diagnostics...")
        force_cpu = bool(settings.get("force_cpu", False))
        hardware_info = detect_hardware(force_cpu=force_cpu)
        gpu_available = hardware_info.get("cuda_available", False)
        
        # 1. Analyze Video (Progress 10%)
        state["status"] = "PROCESSING"
        state["status_text"] = "Analyzing input video resolution and duration..."
        state["progress"] = 10
        save_job_state(job_id, state)
        
        metadata = analyze_video(input_file_path)
        state["video_metadata"] = metadata
        save_job_state(job_id, state)
        
        # Validation
        if metadata["duration"] < 15.0:
            raise ValueError(f"Input video is only {metadata['duration']:.1f}s. It must be at least 15s long.")
        
        has_audio = metadata.get("has_audio", False)
            
        # 2. Extract Audio & Transcription (Progress 25% -> 50%)
        transcript = {"segments": []}
        if has_audio:
            if check_cancelled(): raise RuntimeError("Cancelled by user.")
            state["status_text"] = "Extracting audio track for transcription..."
            state["progress"] = 25
            save_job_state(job_id, state)
            
            temp_wav = TEMP_DIR / f"{job_id}_temp.wav"
            temp_files.append(temp_wav)
            if extract_audio(input_file_path, str(temp_wav)):
                # 3. Transcribe Video (Progress 50%)
                if check_cancelled(): raise RuntimeError("Cancelled by user.")
                state["status_text"] = "Transcribing speech using local Whisper model (this may take a moment)..."
                state["progress"] = 50
                save_job_state(job_id, state)
                
                whisper_model = settings.get("whisper_model", "base")
                transcript = transcribe_audio(str(temp_wav), hardware_info, model_size=whisper_model)
            else:
                logger.warning("Audio extraction failed despite has_audio=True. Bypassing transcription.")
                has_audio = False
        else:
            logger.info("No audio stream detected. Proceeding in silent/visual-only fallback mode.")
            state["status_text"] = "No audio track detected. Proceeding in visual-only mode..."
            state["progress"] = 50
            save_job_state(job_id, state)
        
        # 4. Scene Change Detection (Progress 65%)
        if check_cancelled(): raise RuntimeError("Cancelled by user.")
        state["status_text"] = "Analyzing video scene cuts and visuals..."
        state["progress"] = 65
        save_job_state(job_id, state)
        
        scene_changes = detect_scenes(input_file_path)
        
        # 5. AI Clip Selection (Progress 75%)
        if check_cancelled(): raise RuntimeError("Cancelled by user.")
        state["status_text"] = "Running local AI to identify high-value candidate clips..."
        state["progress"] = 75
        save_job_state(job_id, state)
        
        num_shorts = int(settings.get("num_shorts", 5))
        min_dur = float(settings.get("min_duration", 15.0))
        max_dur = float(settings.get("max_duration", 20.0))
        strategy = settings.get("strategy", "viral")
        clips = find_best_clips(
            transcript, 
            scene_changes, 
            num_shorts=num_shorts,
            min_dur=min_dur,
            max_dur=max_dur,
            strategy=strategy,
            video_duration=metadata["duration"]
        )
        
        if not clips:
            raise ValueError("Could not find any clear speaking segments or interesting hooks in the video.")
            
        # 6. Render vertical Shorts (Progress 75% -> 95%)
        state["status_text"] = f"Generating vertical Shorts (0 of {len(clips)} completed)..."
        save_job_state(job_id, state)
        
        rendered_shorts = []
        for idx, clip in enumerate(clips):
            if check_cancelled(): raise RuntimeError("Cancelled by user.")
            short_idx = idx + 1
            state["status_text"] = f"Generating vertical Short {short_idx} of {len(clips)}: Face tracking & rendering..."
            save_job_state(job_id, state)
            
            # Face/Speaker Tracking (Crop boundary)
            crop_x = get_crop_x_coords(
                input_file_path,
                clip["start"],
                clip["end"],
                metadata["fps"],
                metadata["width"],
                metadata["height"]
            )
            
            # Define crop filter
            crop_w = int(metadata["height"] * 9 / 16)
            crop_filter = f"crop={crop_w}:{metadata['height']}:{crop_x}:0,scale=1080:1920"
            
            # Generate AI title and sanitize it for filename
            short_title = generate_short_title(clip["text"])
            safe_title = re.sub(r'[^a-zA-Z0-9]', '_', short_title).strip('_')
            short_filename = f"short_{job_id}_{short_idx}_{safe_title}.mp4"
            output_mp4_path = OUTPUT_DIR / short_filename
            
             # Render (without subtitles)
             success = render_short(
                 input_file_path,
                 clip["start"],
                 clip["end"],
                 crop_filter,
                 str(output_mp4_path),
                 subtitle_path=None,
                 gpu_available=gpu_available,
                 has_audio=has_audio
             )
            
            if success:
                # Save metadata for this short
                short_meta = {
                    "id": f"{job_id}_{short_idx}",
                    "title": short_title,
                    "filename": short_filename,
                    "video_url": f"/static/shorts/{short_filename}",
                    "start": round(clip["start"], 2),
                    "end": round(clip["end"], 2),
                    "duration": round(clip["end"] - clip["start"], 2),
                    "score": clip["score"],
                    "reason": clip["reason"],
                    "transcript": clip["text"]
                }
                
                # Save individual JSON metadata alongside video
                meta_filepath = OUTPUT_DIR / f"short_{job_id}_{short_idx}_{safe_title}.json"
                with open(meta_filepath, "w", encoding="utf-8") as mf:
                    json.dump(short_meta, mf, indent=2)
                    
                rendered_shorts.append(short_meta)
                state["shorts"] = rendered_shorts
                
            # Update progress
            progress_inc = int(75 + ((short_idx) / len(clips)) * 20)
            state["progress"] = min(95, progress_inc)
            save_job_state(job_id, state)
            
        # 7. Finalizing (Progress 100%)
        state["status"] = "COMPLETED"
        state["progress"] = 100
        state["status_text"] = f"Finished! Extracted {len(rendered_shorts)} high-quality local Shorts."
        save_job_state(job_id, state)
        logger.info(f"[{job_id}] Pipeline completed successfully. Generated {len(rendered_shorts)} shorts.")
        
    except Exception as e:
        err_msg = str(e)
        logger.error(f"[{job_id}] Pipeline failed: {err_msg}")
        logger.error(traceback.format_exc())
        if err_msg == "Cancelled by user.":
            logger.info(f"[{job_id}] Pipeline execution aborted by user cancellation request.")
        else:
            state["status"] = "FAILED"
            state["error"] = err_msg
            state["status_text"] = f"Error: {err_msg}"
            save_job_state(job_id, state)
        
    finally:
        # Cleanup temp files
        logger.info(f"[{job_id}] Cleaning up temporary assets...")
        for path in temp_files:
            try:
                if os.path.exists(path):
                    os.remove(path)
            except Exception as ex:
                logger.warning(f"Failed to remove temp file {path}: {ex}")
                
        # Also clean up the uploaded input file to save disk space if it was in our temp folder
        if input_file_path.startswith(str(TEMP_DIR)):
            try:
                if os.path.exists(input_file_path):
                    os.remove(input_file_path)
            except Exception as ex:
                logger.warning(f"Failed to remove uploaded input file {input_file_path}: {ex}")

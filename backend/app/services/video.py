import subprocess
import json
import re
import os
import logging
from pathlib import Path

logger = logging.getLogger("shorts-generator")

def init_ffmpeg():
    """Ensure FFmpeg and FFprobe are on PATH by using static-ffmpeg."""
    try:
        from static_ffmpeg import add_paths
        add_paths()
        logger.info("static-ffmpeg initialized and added to PATH.")
    except Exception as e:
        logger.error(f"Failed to initialize static-ffmpeg: {e}. Expecting system FFmpeg.")

# Initialize immediately on import
init_ffmpeg()

def analyze_video(video_path: str) -> dict:
    """Run ffprobe to get video duration, resolution, fps, size, and presence of audio/video."""
    cmd = [
        "ffprobe", "-v", "quiet",
        "-print_format", "json",
        "-show_format", "-show_streams",
        video_path
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = json.loads(result.stdout)
        
        format_info = data.get("format", {})
        duration = float(format_info.get("duration", 0))
        size = int(format_info.get("size", 0))
        
        has_video = False
        has_audio = False
        width = 0
        height = 0
        fps = 30.0
        
        for stream in data.get("streams", []):
            codec_type = stream.get("codec_type")
            if codec_type == "video":
                has_video = True
                width = int(stream.get("width", 0))
                height = int(stream.get("height", 0))
                
                # Parse FPS
                avg_frame_rate = stream.get("avg_frame_rate", "30/1")
                if "/" in avg_frame_rate:
                    num, den = avg_frame_rate.split("/")
                    if float(den) > 0:
                        fps = float(num) / float(den)
                else:
                    fps = float(avg_frame_rate)
            elif codec_type == "audio":
                has_audio = True
                
        return {
            "duration": duration,
            "width": width,
            "height": height,
            "fps": round(fps, 2),
            "size": size,
            "has_video": has_video,
            "has_audio": has_audio,
            "file_name": os.path.basename(video_path)
        }
    except Exception as e:
        logger.error(f"ffprobe failed for {video_path}: {e}")
        raise ValueError(f"Unable to read video file metadata: {e}")

def extract_audio(video_path: str, audio_path: str) -> bool:
    """Extract audio from video to mono 16kHz WAV for Whisper."""
    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        audio_path
    ]
    try:
        subprocess.run(cmd, capture_output=True, text=True, check=True)
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"Audio extraction failed: {e.stderr}")
        return False

def detect_scenes(video_path: str, threshold: float = 0.3) -> list:
    """Run FFmpeg scene-change detection and return scene boundary timestamps."""
    cmd = [
        "ffmpeg", "-i", video_path,
        "-vf", f"select='gt(scene,{threshold})',showinfo",
        "-f", "null", "-"
    ]
    scenes = [0.0]  # Start with 0.0 as first scene boundary
    try:
        # Scene detection output is written to stderr of FFmpeg
        proc = subprocess.run(cmd, capture_output=True, text=True)
        stderr = proc.stderr
        
        # Look for showinfo lines: pts_time:6.006
        for line in stderr.splitlines():
            if "Parsed_showinfo" in line and "pts_time:" in line:
                match = re.search(r"pts_time:(\d+\.?\d*)", line)
                if match:
                    scenes.append(float(match.group(1)))
                    
        scenes.sort()
        logger.info(f"Detected {len(scenes) - 1} scene changes in video.")
        return scenes
    except Exception as e:
        logger.error(f"Scene detection failed: {e}. Returning empty list.")
        return [0.0]

def render_short(
    video_path: str,
    start: float,
    end: float,
    crop_filter: str,
    output_path: str,
    subtitle_path: str = None,
    gpu_available: bool = False
) -> bool:
    """Cut, crop, normalize audio, add subtitles, and encode to output path."""
    
    # 1. Base command with fast seek
    cmd = ["ffmpeg", "-y", "-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", video_path]
    
    # 2. Setup video and audio filters
    video_filters = [crop_filter]
    
    # Add subtitles if present
    if subtitle_path and os.path.exists(subtitle_path):
        # Escape path for Windows FFmpeg subtitles filter
        escaped_sub_path = str(subtitle_path).replace("\\", "/").replace(":", "\\:")
        video_filters.append(f"subtitles='{escaped_sub_path}'")
        
    video_filter_str = ",".join(video_filters)
    cmd.extend(["-vf", video_filter_str])
    
    # Audio filters: normalize volume and reduce background noise
    # afftdn: FFT denoiser, loudnorm: EBU R128 loudness normalization
    audio_filter_str = "afftdn,loudnorm"
    cmd.extend(["-af", audio_filter_str])
    
    # 3. Setup encoders
    if gpu_available:
        # NVIDIA GPU accelerated encoding if available
        cmd.extend([
            "-c:v", "h264_nvenc",
            "-preset", "p4",        # Good quality preset
            "-rc:v", "vbr",
            "-cq:v", "24"
        ])
    else:
        # Standard libx264 CPU encoding
        cmd.extend([
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "22"
        ])
        
    cmd.extend([
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        output_path
    ])
    
    try:
        logger.info(f"Rendering short {os.path.basename(output_path)} from {start:.2f}s to {end:.2f}s...")
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"FFmpeg render failed for {output_path}: {e.stderr}")
        return False

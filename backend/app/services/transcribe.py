import logging
import os
from faster_whisper import WhisperModel
from app.core.config import WHISPER_MODEL_SIZE

logger = logging.getLogger("shorts-generator")

# Global model cache to avoid reloading for every video
_model_cache = {}

def get_whisper_model(device: str, compute_type: str) -> WhisperModel:
    """Load and cache the WhisperModel to save memory and startup time."""
    cache_key = (WHISPER_MODEL_SIZE, device, compute_type)
    if cache_key not in _model_cache:
        logger.info(f"Loading local Whisper model '{WHISPER_MODEL_SIZE}' on {device} ({compute_type})...")
        # Whisper model downloads on first use and stores in cache
        _model_cache[cache_key] = WhisperModel(
            WHISPER_MODEL_SIZE,
            device=device,
            compute_type=compute_type
        )
        logger.info(f"Whisper model '{WHISPER_MODEL_SIZE}' loaded successfully.")
    return _model_cache[cache_key]

def transcribe_audio(audio_path: str, hardware_info: dict) -> dict:
    """
    Transcribe wav audio file and extract words with exact timestamps.
    Returns:
        {
            "segments": [
                {
                    "start": float,
                    "end": float,
                    "text": str,
                    "words": [{"word": str, "start": float, "end": float}, ...]
                }, ...
            ],
            "language": str,
            "language_probability": float
        }
    """
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")
        
    device = hardware_info.get("device", "cpu")
    compute_type = hardware_info.get("compute_type", "int8")
    
    model = get_whisper_model(device, compute_type)
    
    logger.info("Starting local speech-to-text transcription...")
    # word_timestamps=True is critical for karaoke subtitles
    segments_gen, info = model.transcribe(
        audio_path,
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,  # Voice Activity Detection to filter out long silences
        vad_parameters=dict(min_silence_duration_ms=500)
    )
    
    segments = []
    for segment in segments_gen:
        words = []
        if segment.words:
            for w in segment.words:
                words.append({
                    "word": w.word,
                    "start": w.start,
                    "end": w.end
                })
        
        segments.append({
            "start": segment.start,
            "end": segment.end,
            "text": segment.text.strip(),
            "words": words
        })
        
    logger.info(f"Speech transcription complete. Detected language: {info.language} ({info.language_probability:.2f})")
    
    return {
        "segments": segments,
        "language": info.language,
        "language_probability": info.language_probability
    }

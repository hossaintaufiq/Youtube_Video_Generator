import sys
import psutil
import logging

logger = logging.getLogger("shorts-generator")

def detect_hardware():
    info = {
        "os": sys.platform,
        "cpu_count": psutil.cpu_count(logical=True),
        "cpu_physical": psutil.cpu_count(logical=False),
        "ram_gb": round(psutil.virtual_memory().total / (1024**3), 2),
        "cuda_available": False,
        "cuda_device_name": None,
        "cuda_vram_gb": 0.0,
        "device": "cpu",
        "compute_type": "int8"  # int8 is best for local CPU Whisper
    }
    
    try:
        import torch
        if torch.cuda.is_available():
            info["cuda_available"] = True
            info["cuda_device_name"] = torch.cuda.get_device_name(0)
            info["cuda_vram_gb"] = round(torch.cuda.get_device_properties(0).total_memory / (1024**3), 2)
            info["device"] = "cuda"
            info["compute_type"] = "float16"  # float16 is fast on GPU
            logger.info(f"NVIDIA GPU detected: {info['cuda_device_name']} with {info['cuda_vram_gb']}GB VRAM")
        else:
            logger.info("No CUDA GPU detected. Falling back to CPU mode.")
    except ImportError:
        logger.warning("PyTorch not installed. Falling back to CPU mode.")
        
    return info

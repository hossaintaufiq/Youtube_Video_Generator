import cv2
import logging
import numpy as np
from pathlib import Path

logger = logging.getLogger("shorts-generator")

def get_crop_x_coords(video_path: str, start_time: float, end_time: float, fps: float, source_w: int, source_h: int) -> int:
    """
    Analyze the video segment, detect the face, and return the optimal horizontal center coordinate.
    We apply a smooth face tracking logic and output the horizontal center X.
    
    Returns:
        crop_x (int): The left coordinate of the 9:16 crop box.
    """
    # Calculate crop width for 9:16 aspect ratio based on source height
    crop_w = int(source_h * 9 / 16)
    
    # If source is already vertical or narrow, just center crop
    if crop_w >= source_w:
        return max(0, (source_w - crop_w) // 2)
        
    # Open video
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        logger.warning(f"Could not open video {video_path} for tracking. Falling back to center crop.")
        return max(0, (source_w - crop_w) // 2)
        
    # Set position to start time
    cap.set(cv2.CAP_PROP_POS_MSEC, start_time * 1000.0)
    
    # Load face detector
    # Haar Cascade is 100% local, lightweight, and built into OpenCV
    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    face_cascade = cv2.CascadeClassifier(cascade_path)
    
    frame_count = int((end_time - start_time) * fps)
    
    # We sample every 5 frames to speed up analysis
    sample_rate = 5
    detected_centers = []
    
    current_frame = 0
    while current_frame < frame_count:
        ret, frame = cap.read()
        if not ret:
            break
            
        if current_frame % sample_rate == 0:
            # Resize frame to speed up detection
            h, w = frame.shape[:2]
            scale = 360.0 / w
            small_frame = cv2.resize(frame, (0, 0), fx=scale, fy=scale)
            gray = cv2.cvtColor(small_frame, cv2.COLOR_BGR2GRAY)
            
            # Detect faces
            faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
            
            if len(faces) > 0:
                # Find largest face (likely the main speaker)
                largest_face = max(faces, key=lambda f: f[2] * f[3])
                fx, fy, fw, fh = largest_face
                
                # Convert back to original coordinate scale
                orig_face_center_x = int((fx + fw / 2) / scale)
                detected_centers.append(orig_face_center_x)
            else:
                detected_centers.append(None)
                
        current_frame += 1
        
    cap.release()
    
    # Process detected centers to find the best smooth coordinate
    # Fill missing values and smooth with Exponential Moving Average (EMA)
    default_center = source_w // 2
    smooth_x = default_center
    alpha = 0.1  # Smoothing factor (lower = smoother panning, higher = faster tracking)
    
    centers_processed = []
    last_known_center = default_center
    
    for c in detected_centers:
        if c is not None:
            last_known_center = c
        centers_processed.append(last_known_center)
        
    if not centers_processed:
        centers_processed = [default_center]
        
    # Calculate average of smoothed coordinates across the segment
    # (Since we render a single crop box or path, for simplicity in FFmpeg standard crop filter,
    # we can use the average smoothed face center over the clip to prevent a constantly sliding video,
    # or calculate a single robust center. A single static crop center per short is often much more
    # comfortable to watch than a sliding one, unless the speaker moves widely.
    # We calculate the median of all tracked face centers to get a robust static position.)
    robust_center = int(np.median(centers_processed))
    
    # Clamp the center so the crop box stays within video bounds
    half_crop = crop_w // 2
    clamped_center = max(half_crop, min(source_w - half_crop, robust_center))
    
    # Left edge of crop box
    crop_x = clamped_center - half_crop
    
    logger.info(f"Tracking determined optimal crop_x: {crop_x} (center: {clamped_center}) for clip {start_time:.1f}s-{end_time:.1f}s.")
    return crop_x

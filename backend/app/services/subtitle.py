import os
import logging

logger = logging.getLogger("shorts-generator")

def format_timestamp(seconds: float) -> str:
    """Format seconds to ASS timestamp: H:MM:SS.cs"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int(round((seconds % 1) * 100))
    if cs == 100:
        s += 1
        cs = 0
        if s == 60:
            m += 1
            s = 0
            if m == 60:
                h += 1
                m = 0
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"

def generate_ass_subtitles(words: list, clip_start: float, clip_end: float, subtitle_path: str):
    """
    Generate an ASS subtitle file with karaoke style word highlighting.
    
    Args:
        words: list of dicts: [{"word": str, "start": float, "end": float}]
        clip_start: start time of the clip in the original video
        clip_end: end time of the clip in the original video
        subtitle_path: file path to write the ASS subtitle file
    """
    # 1. Filter words in the clip range and adjust times
    clip_words = []
    for w in words:
        w_start = w["start"]
        w_end = w["end"]
        
        # Keep words that overlap with the clip
        if w_start >= clip_start and w_end <= clip_end:
            clip_words.append({
                "word": w["word"].strip().upper(),  # UPPERCASE looks punchy and clean
                "start": w_start - clip_start,
                "end": w_end - clip_start
            })
            
    if not clip_words:
        logger.warning(f"No words found for subtitle in clip range {clip_start}-{clip_end}")
        # Create empty ASS file to prevent FFmpeg filter crash
        write_empty_ass(subtitle_path)
        return

    # 2. Group words into lines
    lines = []
    current_line = []
    
    max_words_per_line = 3  # short mobile style
    max_line_duration = 2.0  # seconds
    max_word_gap = 0.5      # seconds
    
    for w in clip_words:
        if not current_line:
            current_line.append(w)
            continue
            
        prev_w = current_line[-1]
        line_duration = w["end"] - current_line[0]["start"]
        word_gap = w["start"] - prev_w["end"]
        
        if (len(current_line) >= max_words_per_line or 
            line_duration > max_line_duration or 
            word_gap > max_word_gap):
            # Save current line
            lines.append(current_line)
            current_line = [w]
        else:
            current_line.append(w)
            
    if current_line:
        lines.append(current_line)

    # 3. Create ASS file content
    # Styles:
    # PrimaryColour: White (&H00FFFFFF)
    # SecondaryColour: Yellow (&H0000FFFF) - used for the active karaoke highlight
    # OutlineColour: Black (&H00000000)
    # Alignment: 2 (bottom center)
    # MarginV: 550 (elevated to sit above Shorts player controls, e.g. like descriptions)
    ass_header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial Black,70,&H00FFFFFF,&H0000FFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,10,0,2,80,80,550,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    events = []
    for i, line_words in enumerate(lines):
        line_start = line_words[0]["start"]
        line_end = line_words[-1]["end"]
        
        # Pad line end slightly if it's the last word of the line to let it stay on screen
        if i < len(lines) - 1:
            # Pad up to start of next line, max 0.3s
            next_line_start = lines[i+1][0]["start"]
            line_end = min(next_line_start, line_end + 0.3)
        else:
            line_end = line_end + 0.5
            
        start_str = format_timestamp(line_start)
        end_str = format_timestamp(line_end)
        
        # Construct karaoke tags
        karaoke_text = ""
        for idx, w in enumerate(line_words):
            # Calculate duration in centiseconds (1/100s)
            if idx < len(line_words) - 1:
                # Duration is from current word start to next word start (fills silence)
                duration_sec = line_words[idx+1]["start"] - w["start"]
            else:
                # Last word duration is its own duration
                duration_sec = w["end"] - w["start"]
                
            duration_cs = max(1, int(round(duration_sec * 100)))
            
            # Format word
            word_str = w["word"]
            # Add trailing space except for last word
            if idx < len(line_words) - 1:
                word_str += " "
                
            karaoke_text += f"{{\\kf{duration_cs}}}{word_str}"
            
        events.append(f"Dialogue: 0,{start_str},{end_str},Default,,0,0,0,,{karaoke_text}")

    with open(subtitle_path, "w", encoding="utf-8") as f:
        f.write(ass_header)
        f.write("\n".join(events))
        f.write("\n")
        
    logger.info(f"Generated ASS subtitle file at {subtitle_path} with {len(events)} dialogue lines.")

def write_empty_ass(subtitle_path: str):
    """Write a valid empty ASS file to prevent FFmpeg filters from crashing."""
    ass_header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial Black,70,&H00FFFFFF,&H0000FFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,10,0,2,80,80,550,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    with open(subtitle_path, "w", encoding="utf-8") as f:
        f.write(ass_header)

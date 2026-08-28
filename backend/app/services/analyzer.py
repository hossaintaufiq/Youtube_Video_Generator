import logging
import re
import requests
from app.core.config import OLLAMA_API_URL, OLLAMA_MODEL

logger = logging.getLogger("shorts-generator")

# Common introduction words to penalize at the start of a hook
GREETINGS_FILLERS = {
    "hello", "hi", "hey", "welcome", "guys", "everyone", "today", "yesterday",
    "tomorrow", "so", "basically", "actually", "anyway", "subscribe", "channel",
    "video", "intro", "introduction"
}

# High engagement/hook words
HOOK_KEYWORDS = {
    "why", "how", "what", "secret", "mistake", "error", "fail", "failed", "failure",
    "success", "trick", "hacks", "hack", "never", "always", "shocking", "amazing",
    "crazy", "stupid", "smart", "stop", "avoid", "destroy", "build", "money",
    "billion", "million", "free", "worst", "best", "truth", "lie", "lies"
}

# Stop words to filter content density
STOP_WORDS = {
    "the", "a", "an", "and", "or", "but", "if", "because", "as", "until", "while",
    "of", "at", "by", "for", "with", "about", "against", "between", "into", "through",
    "during", "before", "after", "above", "below", "to", "from", "up", "down", "in",
    "out", "on", "off", "over", "under", "again", "further", "then", "once", "here",
    "there", "when", "where", "why", "how", "all", "any", "both", "each", "few",
    "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same",
    "so", "than", "too", "very", "s", "t", "can", "will", "just", "don", "should", "now"
}

def check_ollama_available() -> bool:
    """Helper to check if a local Ollama service is running."""
    try:
        response = requests.get(OLLAMA_API_URL.rsplit("/chat", 1)[0], timeout=1.0)
        return response.status_code == 200
    except Exception:
        return False

def query_ollama_score(text: str) -> float:
    """Query local Ollama to score a candidate clip's hook and standalone value (0-100)."""
    prompt = f"""
    You are an expert viral content creator. Rate the following clip transcript for a short vertical video (YouTube Shorts/TikTok).
    Evaluate it based on:
    1. Hook Strength: Does the beginning capture attention?
    2. Standalone value: Does the clip make complete sense on its own without outside context?
    
    Transcript: "{text}"
    
    Respond in JSON format only with a single key "score" which must be a number between 0 and 100.
    Example response:
    {{"score": 85}}
    """
    
    try:
        payload = {
            "model": OLLAMA_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "format": "json"
        }
        res = requests.post(OLLAMA_API_URL, json=payload, timeout=5.0)
        if res.status_code == 200:
            data = res.json()
            content = data.get("message", {}).get("content", "")
            # Parse score
            match = re.search(r'"score":\s*(\d+)', content)
            if match:
                return float(match.group(1))
    except Exception as e:
        logger.warning(f"Ollama scoring failed: {e}. Falling back to NLP heuristics.")
    return 50.0

def generate_sentences(words: list) -> list:
    """
    Group words into logical sentences based on Whisper punctuation or pauses (>0.4s).
    Returns list of dicts: {"text": str, "start": float, "end": float, "words": [...]}
    """
    sentences = []
    current_sentence = []
    
    for idx, w in enumerate(words):
        current_sentence.append(w)
        
        # Word text clean
        word_text = w["word"].strip()
        
        # Determine sentence boundary:
        is_boundary = False
        
        # 1. Punctuation in Whisper transcript
        if word_text and word_text[-1] in {".", "?", "!"}:
            is_boundary = True
            
        # 2. Long pause before next word
        elif idx < len(words) - 1:
            next_w = words[idx + 1]
            gap = next_w["start"] - w["end"]
            if gap > 0.45:
                is_boundary = True
                
        # 3. Last word
        elif idx == len(words) - 1:
            is_boundary = True
            
        if is_boundary:
            text = " ".join([item["word"].strip() for item in current_sentence])
            # Filter empty
            if text:
                sentences.append({
                    "text": text,
                    "start": current_sentence[0]["start"],
                    "end": current_sentence[-1]["end"],
                    "words": current_sentence
                })
            current_sentence = []
            
    return sentences

def score_candidate(text: str, start: float, end: float, scene_changes: list, sentence_start: dict, sentence_end: dict) -> dict:
    """Score a candidate clip based on our multi-factor NLP heuristics."""
    duration = end - start
    
    # 1. Hook Score (25 points max)
    # Check the first few words of the first sentence
    hook_text = sentence_start["text"].lower()
    first_words = re.findall(r"\b\w+\b", hook_text)[:5]
    
    hook_points = 12.5  # Neutral base
    
    # Penalize filler openings or greetings
    if any(w in GREETINGS_FILLERS for w in first_words):
        hook_points -= 8
    
    # Reward hook keyword matches
    if any(w in HOOK_KEYWORDS for w in first_words):
        hook_points += 10.5
        
    hook_points = max(0.0, min(25.0, hook_points))
    
    # 2. Completeness & Boundary Cleanliness (25 points max)
    completeness_points = 25.0
    text_clean = text.strip()
    
    # Does it start with a capitalized word?
    if text_clean and not text_clean[0].isupper():
        completeness_points -= 5
        
    # Does it end with terminal punctuation?
    if text_clean and text_clean[-1] not in {".", "?", "!"}:
        completeness_points -= 10
        
    # Does it end with an unfinished conjunction?
    last_words = text_clean.lower().split()
    if last_words and last_words[-1] in {"and", "but", "because", "so", "or", "if"}:
        completeness_points -= 10
        
    completeness_points = max(0.0, min(25.0, completeness_points))
    
    # 3. Pacing / Speech rate (15 points max)
    # Ideal words per minute (WPM) = 130 to 160 WPM
    words = text_clean.split()
    wpm = (len(words) / duration) * 60
    
    if 130 <= wpm <= 165:
        pacing_points = 15.0
    elif 100 <= wpm < 130 or 165 < wpm <= 190:
        pacing_points = 10.0
    else:
        pacing_points = 5.0
        
    # 4. Information Density (15 points max)
    # Ratio of content words (non-stop words) to total words
    content_words = [w for w in words if w.lower() not in STOP_WORDS]
    density_ratio = len(content_words) / max(1, len(words))
    density_points = min(15.0, density_ratio * 30.0)
    
    # 5. Visual Scene Changes (10 points max)
    # Visual action (scene cuts inside the clip).
    # 2-5 scene cuts per 18 seconds is ideal.
    cuts_in_clip = sum(1 for ts in scene_changes if start <= ts <= end)
    if 2 <= cuts_in_clip <= 6:
        visual_points = 10.0
    elif cuts_in_clip == 1 or 6 < cuts_in_clip <= 9:
        visual_points = 7.0
    else:
        # 0 cuts (static) or excessive cuts (noisy)
        visual_points = 4.0
        
    # 6. Content/Keyword Match (10 points max)
    # Reward presence of numbers, quotes, or strong adjectives
    content_points = 2.0
    if any(char.isdigit() for char in text):
        content_points += 3.0
    if any(w in HOOK_KEYWORDS for w in words):
        content_points += 5.0
    content_points = min(10.0, content_points)
    
    # Combine scores
    base_score = hook_points + completeness_points + pacing_points + density_points + visual_points + content_points
    
    reason = "Balanced information density and smooth pacing."
    if hook_points > 18:
        reason = "Strong hook statement and complete sentence structure."
    elif content_points > 7:
        reason = "High-value statement with key information keywords."
    elif visual_points == 10:
        reason = "Good editing pace and scene changes."
        
    return {
        "score": round(base_score, 1),
        "reason": reason,
        "metrics": {
            "hook": round(hook_points, 1),
            "completeness": round(completeness_points, 1),
            "pacing_wpm": round(wpm, 1),
            "density_ratio": round(density_ratio, 2)
        }
    }

def find_best_clips(transcript: dict, scene_changes: list, num_shorts: int = 5) -> list:
    """
    Examine the transcript and select the highest scoring non-overlapping 15-20s clips.
    """
    # 1. Flatten all words into a single list
    all_words = []
    for seg in transcript.get("segments", []):
        all_words.extend(seg.get("words", []))
        
    if not all_words:
        logger.warning("No words found in transcript. Cannot select clips.")
        return []
        
    # 2. Group into sentences
    sentences = generate_sentences(all_words)
    if not sentences:
        logger.warning("Could not group transcript into sentences.")
        return []
        
    candidates = []
    min_dur = 15.0
    max_dur = 20.0
    
    # Check if local Ollama is active
    ollama_active = check_ollama_available()
    if ollama_active:
        logger.info(f"Ollama detected active on {OLLAMA_API_URL}. Incorporating LLM semantic scoring.")
    
    # 3. Slide window over sentences
    for i in range(len(sentences)):
        start_sent = sentences[i]
        start_time = start_sent["start"]
        
        # Build candidate by adding consecutive sentences
        for j in range(i, len(sentences)):
            end_sent = sentences[j]
            end_time = end_sent["end"]
            duration = end_time - start_time
            
            if duration > max_dur:
                break
                
            if min_dur <= duration <= max_dur:
                # Combine text
                text = " ".join([sentences[k]["text"] for k in range(i, j + 1)])
                
                # Compute base NLP score
                eval_data = score_candidate(
                    text, start_time, end_time, scene_changes, start_sent, end_sent
                )
                
                # If Ollama is active, combine scores (70% NLP Heuristic, 30% LLM)
                if ollama_active:
                    llm_score = query_ollama_score(text)
                    combined_score = (eval_data["score"] * 0.7) + (llm_score * 0.3)
                    eval_data["score"] = round(combined_score, 1)
                    eval_data["reason"] = f"AI selected: {eval_data['reason']} (Ollama validated)"
                
                candidates.append({
                    "start": start_time,
                    "end": end_time,
                    "text": text,
                    "score": eval_data["score"],
                    "reason": eval_data["reason"],
                    "words": all_words  # Keep reference to all words for subtitles
                })
                
    # Sort candidates by score descending
    candidates.sort(key=lambda x: x["score"], reverse=True)
    
    # 4. Resolve overlaps greedily
    selected_clips = []
    for cand in candidates:
        if len(selected_clips) >= num_shorts:
            break
            
        # Check collision with already selected clips
        collision = False
        for sel in selected_clips:
            # Overlap formula: start1 < end2 and start2 < end1
            # We also avoid clips starting too close to each other (margin of 3 seconds)
            if cand["start"] - 3.0 < sel["end"] and sel["start"] - 3.0 < cand["end"]:
                collision = True
                break
                
        if not collision:
            selected_clips.append(cand)
            
    logger.info(f"Selected {len(selected_clips)} high-quality non-overlapping short clips.")
    return selected_clips

def generate_short_title(text: str) -> str:
    """Generate a punchy 3-5 word clickbait title for the short."""
    ollama_active = check_ollama_available()
    if ollama_active:
        prompt = f"""
        Generate a punchy, clickbait, 3 to 5-word title for a vertical video with the following transcript:
        "{text}"
        
        Respond ONLY with the title. Do not include quotes, explanations, or punctuation.
        """
        try:
            payload = {
                "model": OLLAMA_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False
            }
            res = requests.post(OLLAMA_API_URL, json=payload, timeout=3.0)
            if res.status_code == 200:
                title = res.json().get("message", {}).get("content", "").strip()
                # Clean quotes and punctuation
                title = re.sub(r'[\'\".,\/#!$%\^&\*;:{}==_`~()]', '', title)
                if title:
                    return title.title()
        except Exception:
            pass
            
    # Fallback to local NLP extraction
    words = re.findall(r"\b\w+\b", text)
    # Filter stop words, keep nouns/verbs/hook words
    important_words = [w.capitalize() for w in words if w.lower() not in STOP_WORDS]
    if len(important_words) < 3:
        # Fallback to just the first 4 words
        important_words = [w.capitalize() for w in words[:4]]
        
    title = " ".join(important_words[:4])
    if not title:
        title = "Short Clip"
    return title


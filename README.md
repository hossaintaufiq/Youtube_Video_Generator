# 🎬 Local AI Video-to-Shorts Generator MVP

A professional desktop web application that runs **100% locally and privately on your computer**. It takes a single horizontal video file (such as a podcast or talking-head video) as input, analyzes it using speech-to-text transcription, runs local AI heuristic evaluations to find the most engaging 15-20s clips, automatically crops and reframes the visual to a vertical 9:16 layout centering the speaker, and saves the final outputs using AI-generated titles.

---

## ✨ Key Features

- **🔒 100% Private & Local**: Your videos, audio, and transcripts never leave your computer. All processing happens entirely offline.
- **🎙️ Local Whisper Transcription**: Integrates `faster-whisper` (CTranslate2 version of OpenAI's Whisper model) to transcribe speech locally on CPU or GPU.
- **🧠 Semantic Moment Selection**: Automatically analyzes sentence structures, speech pace, and hook keywords to select self-contained moments between 15 and 20 seconds.
- **🔍 Smart Face-Tracking Reframer**: Employs an OpenCV Haar Cascade face-detection model to track the speaker's horizontal coordinates, using an Exponential Moving Average (EMA) filter to smoothly pan the camera frame without jitter.
- **🏷️ AI-Generated Titles**: Automatically generates clickbait, punchy 3-5 word titles based on the transcript segment (using local Ollama or built-in NLP heuristics), saving the output files using the generated titles.
- **🎛️ Local Media Normalization**: Automatically normalizes video volume (using EBU R128 loudness standards) and runs an FFT denoiser on audio streams to maximize audio quality.

---

## 📂 Project Repository Structure

```text
├── backend/                      # FastAPI Python Application
│   ├── app/
│   │   ├── core/
│   │   │   ├── config.py         # App configurations & output paths
│   │   │   └── hardware.py       # Auto-detects NVIDIA CUDA GPU / CPU capabilities
│   │   ├── services/
│   │   │   ├── video.py          # FFmpeg bindings (scene change, cropping, audio filter)
│   │   │   ├── transcribe.py     # Local faster-whisper speech-to-text
│   │   │   ├── analyzer.py       # Sentence windowing, scoring, and AI title generator
│   │   │   ├── tracker.py        # Face tracking & smoothing coordinates
│   │   │   └── pipeline.py       # Threaded background worker coordinator
│   │   └── main.py               # REST endpoints (upload, jobs, downloads, CORS)
│   └── requirements.txt          # Python dependencies
├── frontend/                     # React + Vite Client
│   ├── src/
│   │   ├── components/           # Custom visual UI modules
│   │   ├── App.tsx               # Dashboard, Drag-Drop Upload, Job Queue, Shorts Grid
│   │   ├── index.css             # Tailwind v4 import & custom scrollbar styles
│   │   └── main.tsx              # React mounting
│   ├── postcss.config.js         # PostCSS configuration for Tailwind v4
│   ├── tailwind.config.js        # Content path tracking
│   ├── vite.config.ts            # Vite compiler configurations
│   └── package.json              # NPM package configurations
├── shorts/                       # Automatically created folder containing generated videos
├── run.py                        # Master startup script (boots both frontend & backend)
├── .gitignore                    # Git file mappings
└── README.md                     # Documentation
```

---

## 🚀 Quick Start (Automated Launch)

At the root directory of the workspace, run the server launcher script:

```bash
python run.py
```

This master runner will automatically:
1. Boot the FastAPI backend server on `http://127.0.0.1:8000`.
2. Boot the Vite React development server on `http://127.0.0.1:5173`.
3. Open your default web browser to the dashboard.
4. Stream logs from both servers directly into your terminal.

*To shut down both servers, press `Ctrl+C` in your terminal window.*

---

## 🛠️ Manual Installation & Developer Setup

### Prerequisites
- **Python 3.8 to 3.10**: Python 3.10 is highly recommended for pre-compiled binary wheel support for PyTorch and faster-whisper.
- **Node.js 18+**: For compiling frontend assets.

### 1. Backend Environment Setup
Run these commands from the root directory:

```bash
# Initialize Python 3.10 virtual environment
py -3.10 -m venv venv

# Upgrade pip
.\venv\Scripts\python.exe -m pip install --upgrade pip

# Install dependencies (automatic FFmpeg downloader is included)
.\venv\Scripts\pip.exe install -r backend/requirements.txt
```

### 2. Frontend Setup
Run these commands from the root directory:

```bash
cd frontend
npm install
```

### 3. Running Services Separately
If you prefer not to use `run.py`, you can launch services in separate terminal sessions:

- **Run Backend**:
  ```bash
  cd backend
  ..\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
  ```
- **Run Frontend**:
  ```bash
  cd frontend
  npm run dev
  ```

---

## ⚙️ Advanced Configuration

### Hardware Acceleration (GPU vs. CPU)
The backend automatically runs hardware diagnostics:
- **GPU Mode**: If an NVIDIA card is detected with CUDA support, the pipeline loads Whisper onto your GPU using `float16` precision and compiles vertical crops using the `h264_nvenc` hardware video encoder.
- **CPU Fallback**: If no GPU is available, the system switches to CPU mode using `int8` quantization size to minimize processor load.

### Optional local LLM support (Ollama)
For semantic scoring validation and smart clickbait titling, the backend can connect to a local **Ollama** server:
1. Install [Ollama](https://ollama.com/).
2. Pull a lightweight model (e.g. `qwen2.5:3b`):
   ```bash
   ollama pull qwen2.5:3b
   ```
3. Run the Ollama desktop app. The backend will automatically detect the server and integrate it. If Ollama is offline, it falls back to built-in local NLP keyword rules instantly.

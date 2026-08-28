import subprocess
import sys
import time
import os
import signal
import webbrowser
from pathlib import Path

# Print ASCII banner
BANNER = """
   ==================================================
              NEPTUNE SHORTS GENERATOR
   ==================================================
   [*] Running 100% locally with Whisper and FFmpeg
   [*] Starting local servers...
   ==================================================
"""

def main():
    print(BANNER)
    
    workspace_dir = Path(__file__).resolve().parent
    backend_dir = workspace_dir / "backend"
    frontend_dir = workspace_dir / "frontend"
    
    # Path to venv python
    venv_python = workspace_dir / "venv" / "Scripts" / "python.exe"
    if not venv_python.exists():
        print(f"[!] Error: Virtual environment python not found at {venv_python}")
        print("[!] Please run environment setup first.")
        sys.exit(1)
        
    processes = []
    
    # 1. Start Backend (FastAPI + Uvicorn)
    print("[*] Starting backend server on http://127.0.0.1:8000 ...")
    backend_cmd = [
        str(venv_python), "-m", "uvicorn", 
        "app.main:app", 
        "--host", "127.0.0.1", 
        "--port", "8000",
        "--reload"
    ]
    
    try:
        backend_proc = subprocess.Popen(
            backend_cmd,
            cwd=str(backend_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )
        processes.append(("Backend", backend_proc))
    except Exception as e:
        print(f"[!] Failed to start backend process: {e}")
        sys.exit(1)
        
    # Give backend a moment to bind to the port
    time.sleep(2)
    
    # 2. Start Frontend (Vite Dev Server)
    print("[*] Starting frontend development server on http://127.0.0.1:5173 ...")
    frontend_cmd = ["npm.cmd", "run", "dev"]
    
    try:
        frontend_proc = subprocess.Popen(
            frontend_cmd,
            cwd=str(frontend_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )
        processes.append(("Frontend", frontend_proc))
    except Exception as e:
        print(f"[!] Failed to start frontend process: {e}")
        # Kill backend before exit
        backend_proc.terminate()
        sys.exit(1)
        
    # Give frontend a moment to start
    time.sleep(2)
    
    # Automatically open browser
    print("[*] Launching browser to http://127.0.0.1:5173 ...")
    webbrowser.open("http://127.0.0.1:5173")
    
    print("\n[*] Application running! Press Ctrl+C to terminate both servers and exit.\n")
    
    # Thread helper to print stdout logs without blocking main thread
    import threading
    
    def log_streamer(name, process):
        while True:
            line = process.stdout.readline()
            if not line:
                break
            # Print with tag
            print(f"[{name}] {line.strip()}")
            
    for name, proc in processes:
        t = threading.Thread(target=log_streamer, args=(name, proc), daemon=True)
        t.start()
        
    try:
        # Keep main thread alive monitoring processes
        while True:
            # Check if any process has exited unexpectedly
            for name, proc in processes:
                ret = proc.poll()
                if ret is not None:
                    print(f"\n[!] Process {name} exited unexpectedly with code {ret}.")
                    raise KeyboardInterrupt
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[*] Shutting down servers gracefully...")
        for name, proc in processes:
            print(f"[*] Terminating {name}...")
            # On Windows, terminate() is standard, but sometimes taskkill is needed
            try:
                proc.terminate()
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                print(f"[!] Force killing {name}...")
                proc.kill()
            except Exception as ex:
                print(f"[!] Error killing {name}: {ex}")
                
        print("[*] Cleanup complete. Goodbye!")

if __name__ == "__main__":
    main()

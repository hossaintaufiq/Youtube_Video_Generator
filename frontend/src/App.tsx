import React, { useState, useEffect, useRef } from "react";

const BACKEND_URL = "http://127.0.0.1:8000";


interface VideoMetadata {
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  size?: number;
  file_name?: string;
  has_audio?: boolean;
}

interface ShortClip {
  id: string;
  title?: string;
  filename: string;
  video_url: string;
  start: number;
  end: number;
  duration: number;
  score: number;
  reason: string;
  transcript: string;
}

interface Job {
  id: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  progress: number;
  status_text: string;
  error: string | null;
  input_file: string;
  video_metadata: VideoMetadata;
  settings?: Record<string, any>;
  shorts: ShortClip[];
  created_at: string;
}

export default function App() {
  // Input states
  const [file, setFile] = useState<File | null>(null);
  const [numShorts, setNumShorts] = useState<number>(5);
  const [minDuration, setMinDuration] = useState<number>(15);
  const [maxDuration, setMaxDuration] = useState<number>(20);
  const [strategy, setStrategy] = useState<string>("viral");
  const [whisperModel, setWhisperModel] = useState<string>("base");
  const [forceCpu, setForceCpu] = useState<boolean>(false);
  const [aspectRatio, setAspectRatio] = useState<string>("9:16");
  
  const [isBackendConnected, setIsBackendConnected] = useState<boolean>(true);

  // App states
  const [jobs, setJobs] = useState<Job[]>([]);
  const [shorts, setShorts] = useState<ShortClip[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  interface HardwareInfo {
    os: string;
    cpu_count: number;
    cpu_physical: number;
    ram_gb: number;
    cuda_available: boolean;
    cuda_device_name: string | null;
    cuda_vram_gb: number;
    device: string;
    compute_type: string;
  }
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);

  // Toast notifications state
  interface Toast {
    id: string;
    type: "success" | "error" | "info";
    title: string;
    message: string;
  }
  const [toasts, setToasts] = useState<Toast[]>([]);
  
  const showToast = (type: "success" | "error" | "info", title: string, message: string) => {
    const id = Math.random().toString(36).substring(7);
    setToasts(prev => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  };

  // Custom confirmation modal state
  interface ConfirmModalState {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {}
  });
  
  const triggerConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      onConfirm: () => {
        onConfirm();
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };
  
  const [activeMonitorTab, setActiveMonitorTab] = useState<"monitor" | "trending">("monitor");
  
  interface TrendingVideo {
    id: string;
    title: string;
    channel: string;
    category: string;
    views: string;
    rank: string;
    video_id: string;
    url: string;
    thumbnail_url: string;
    license: string;
    copyright_free: boolean;
    reason: string;
  }
  const [trendingVideos, setTrendingVideos] = useState<TrendingVideo[]>([]);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>("All");
  const [ytCheckUrl, setYtCheckUrl] = useState("");
  const [ytCheckResult, setYtCheckResult] = useState<TrendingVideo | null>(null);
  const [isCheckingYt, setIsCheckingYt] = useState(false);

  const fetchTrending = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/youtube/trending`);
      if (res.ok) {
        const data = await res.json();
        setTrendingVideos(data);
      }
    } catch {
      showToast("error", "API Error", "Could not fetch trending YouTube videos.");
    }
  };

  const handleCheckCopyright = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ytCheckUrl.trim()) return;
    setIsCheckingYt(true);
    setYtCheckResult(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/youtube/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: ytCheckUrl })
      });
      if (res.ok) {
        const data = await res.json();
        setYtCheckResult(data);
        showToast("success", "Scan Complete", "Retrieved stream copyright classification details.");
      } else {
        showToast("error", "Scan Failed", "Unable to analyze YouTube licensing.");
      }
    } catch {
      showToast("error", "Connection Error", "Failed to communicate with local copyright analyzer.");
    } finally {
      setIsCheckingYt(false);
    }
  };

  // Drag & drop state
  const [isDragging, setIsDragging] = useState(false);
  const [expandedJobs, setExpandedJobs] = useState<Record<string, boolean>>({});
  
  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Poll intervals
  useEffect(() => {
    fetchJobs();
    fetchShorts();
    fetchTrending();
    
    const interval = setInterval(() => {
      fetchJobs();
      fetchShorts();
    }, 2000);
    
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchHardware();
  }, [forceCpu]);

  const fetchHardware = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/hardware?force_cpu=${forceCpu}`);
      if (res.ok) {
        const data = await res.json();
        setHardware(data);
        setIsBackendConnected(true);
      } else {
        setIsBackendConnected(false);
      }
    } catch (err) {
      console.error("Failed to fetch hardware status:", err);
      setIsBackendConnected(false);
    }
  };

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/jobs`);
      if (res.ok) {
        const data = await res.json();
        setJobs(data);
        setIsBackendConnected(true);
      } else {
        setIsBackendConnected(false);
      }
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
      setIsBackendConnected(false);
    }
  };

  const fetchShorts = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/shorts`);
      if (res.ok) {
        const data = await res.json();
        setShorts(data);
        setIsBackendConnected(true);
      } else {
        setIsBackendConnected(false);
      }
    } catch (err) {
      console.error("Failed to fetch shorts:", err);
      setIsBackendConnected(false);
    }
  };

  // Drag & Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      validateAndSetFile(droppedFile);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (selectedFile: File) => {
    const ext = selectedFile.name.substring(selectedFile.name.lastIndexOf(".")).toLowerCase();
    const validExtensions = [".mp4", ".mov", ".mkv", ".avi", ".webm"];
    
    if (!validExtensions.includes(ext)) {
      showToast("error", "Invalid File Format", `Unsupported type ${ext}. Please upload MP4, MOV, MKV, AVI or WebM.`);
      setFile(null);
      return;
    }
    
    setFile(selectedFile);
  };

  // Upload and Submit Job
  const handleGenerateShorts = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setIsUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("num_shorts", numShorts.toString());
    formData.append("min_duration", minDuration.toString());
    formData.append("max_duration", maxDuration.toString());
    formData.append("strategy", strategy);
    formData.append("whisper_model", whisperModel);
    formData.append("force_cpu", forceCpu.toString());
    formData.append("aspect_ratio", aspectRatio);

    // Use XMLHttpRequest to track upload progress
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BACKEND_URL}/api/jobs/upload`, true);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percent);
      }
    };

    xhr.onload = () => {
      setIsUploading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        const response = JSON.parse(xhr.responseText);
        showToast("success", "Video Uploaded", `Generating Shorts on job: ${response.job_id}`);
        setFile(null); // Clear input
        if (fileInputRef.current) fileInputRef.current.value = "";
        fetchJobs();
      } else {
        try {
          const errData = JSON.parse(xhr.responseText);
          showToast("error", "Upload Failed", errData.detail || "Upload failed. Please try again.");
        } catch {
          showToast("error", "Upload Failed", "Upload failed. Make sure backend server is running.");
        }
      }
    };

    xhr.onerror = () => {
      setIsUploading(false);
      showToast("error", "Network Error", "Unable to connect to local server.");
    };

    xhr.send(formData);
  };

  // Delete Short
  const handleDeleteShort = (filename: string) => {
    triggerConfirm(
      "Delete Generated Short",
      `Are you sure you want to delete this short: ${filename}? This action is permanent and deletes the file from local storage.`,
      async () => {
        try {
          const res = await fetch(`${BACKEND_URL}/api/shorts/${filename}`, {
            method: "DELETE"
          });
          if (res.ok) {
            showToast("success", "Short Deleted", `Deleted short video file: ${filename}`);
            fetchShorts();
          } else {
            const err = await res.json();
            showToast("error", "Action Failed", err.detail || "Failed to delete short.");
          }
        } catch {
          showToast("error", "Connection Error", "Error communicating with local server to delete short.");
        }
      }
    );
  };

  // Cancel active job
  const handleCancelJob = (jobId: string) => {
    triggerConfirm(
      "Cancel Active Generation",
      "Are you sure you want to cancel this background generation? The rendering thread will terminate cleanly.",
      async () => {
        try {
          const res = await fetch(`${BACKEND_URL}/api/jobs/${jobId}/cancel`, {
            method: "POST"
          });
          if (res.ok) {
            showToast("info", "Job Cancelled", "Cancellation request sent to background thread.");
            fetchJobs();
          } else {
            showToast("error", "Action Failed", "Could not send cancellation request.");
          }
        } catch {
          showToast("error", "Connection Error", "Failed to communicate with local server.");
        }
      }
    );
  };

  // Delete Job Log
  const handleDeleteJobLog = (jobId: string) => {
    triggerConfirm(
      "Delete Job Log Record",
      "Are you sure you want to delete this job record? This deletes the execution log metadata off your disk.",
      async () => {
        try {
          const res = await fetch(`${BACKEND_URL}/api/jobs/${jobId}`, {
            method: "DELETE"
          });
          if (res.ok) {
            showToast("success", "Record Deleted", "Removed job log file from local storage.");
            fetchJobs();
          } else {
            showToast("error", "Action Failed", "Could not delete job record.");
          }
        } catch {
          showToast("error", "Connection Error", "Failed to communicate with local server.");
        }
      }
    );
  };

  // Format Helper functions
  const formatBytes = (bytes: number = 0, decimals = 2) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  const formatSeconds = (secs: number = 0) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };
  const activeJobs = jobs.filter(j => j.status === "PROCESSING" || j.status === "QUEUED");
  const completedJobs = jobs.filter(j => j.status === "COMPLETED" || j.status === "FAILED");

  return (
    <div className="min-h-screen flex flex-col bg-[#020711] text-[#C5C6C7] font-sans antialiased">
      
      {/* NLE Application Toolbar Header */}
      <header className="border-b border-[#0f1d36] bg-[#040E1E] py-3.5 px-6 sticky top-0 z-50 backdrop-blur-md bg-opacity-95 select-none flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* macOS Style window dots */}
          <div className="flex gap-1.5 shrink-0">
            <span className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E]"></span>
            <span className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123]"></span>
            <span className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB2F]"></span>
          </div>
          
          <div className="h-4 w-px bg-gray-800"></div>
          
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gradient-to-tr from-[#00F2FE] to-[#4FACFE] flex items-center justify-center text-[#020711] font-black text-xs shadow-md">
              NS
            </div>
            <h1 className="text-xs font-black tracking-widest text-white uppercase font-mono">Neptune Shorts Studio v2.0</h1>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            {isBackendConnected ? (
              <span className="flex items-center gap-1.5 text-[10px] text-emerald-400 bg-emerald-950/20 py-1 px-3 rounded border border-emerald-500/20 font-bold font-mono uppercase tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Console Connected
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-[10px] text-red-400 bg-red-950/20 py-1 px-3 rounded border border-red-500/20 font-bold font-mono uppercase tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"></span>
                Console Offline
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Mock NLE Sub-Menu Bar */}
      <div className="flex items-center justify-between bg-[#040E20] border-b border-[#0f1d36] px-6 py-1.5 text-[10px] text-gray-500 font-medium select-none">
        <div className="flex gap-4">
          <span className="hover:text-white cursor-pointer transition-all">Project</span>
          <span className="hover:text-white cursor-pointer transition-all">Clip</span>
          <span className="hover:text-white cursor-pointer transition-all">Sequence</span>
          <span className="hover:text-white cursor-pointer transition-all">AI Engine</span>
          <span className="hover:text-white cursor-pointer transition-all">Hardware</span>
          <span className="hover:text-white cursor-pointer transition-all">Help</span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[9px]">
          <span className="text-gray-600">WORKSPACE:</span>
          <span className="text-[#00F2FE] font-bold">DEFAULT EDITING LAYOUT</span>
        </div>
      </div>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 flex flex-col gap-6">
        
        {/* Alerts managed dynamically via floating toasts */}

        {/* Dashboard Grid (Inputs / Settings vs Processing Jobs) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Left Column: Import & Properties (5 cols) */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            
            {/* Panel Tab Header */}
            <div className="flex border-b border-[#0f1d36] bg-[#040E20]/50 rounded-t-xl overflow-hidden">
              <span className="px-4 py-2 text-[10px] font-bold tracking-widest text-[#00F2FE] border-b-2 border-[#00F2FE] bg-[#081C36]/50 uppercase font-mono">
                Project Import
              </span>
              <span className="px-4 py-2 text-[10px] font-bold tracking-widest text-gray-500 hover:text-white transition-all uppercase font-mono cursor-not-allowed">
                Audio Bin
              </span>
            </div>

            {/* Input Form Card */}
            <form onSubmit={handleGenerateShorts} className="bg-[#081C36] border border-[#0f1d36] rounded-b-2xl rounded-tr-2xl p-5 shadow-xl flex flex-col gap-5">
              
              {/* Drag & Drop File Picker */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-300 ${
                  isDragging 
                    ? "border-[#00F2FE] bg-[#00f2fe08] scale-[0.99]" 
                    : file 
                      ? "border-emerald-500 bg-emerald-950/10" 
                      : "border-[#4FACFE]/40 hover:border-[#00F2FE] bg-[#030C1B]"
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept=".mp4,.mov,.mkv,.avi,.webm"
                  className="hidden"
                  disabled={isUploading}
                />
                
                {file ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-10 h-10 rounded-full bg-emerald-950 border border-emerald-500 flex items-center justify-center text-emerald-400 mb-1">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <h4 className="text-white font-bold text-xs truncate max-w-[220px]" title={file.name}>{file.name}</h4>
                    <div className="flex gap-3 text-[10px] text-[#45A29E] font-mono mt-0.5">
                      <span>{formatBytes(file.size)}</span>
                      <span>{file.name.substring(file.name.lastIndexOf(".")).toUpperCase()}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-10 h-10 rounded-full bg-[#081C36] flex items-center justify-center text-[#00F2FE] mb-1">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-white font-bold text-xs">Import Source Media</p>
                      <p className="text-[#4FACFE] text-[10px] mt-0.5">Drag file here or click to browse</p>
                    </div>
                    <div className="mt-1 text-[8px] text-gray-500 font-mono">
                      MP4, MOV, MKV, AVI, WebM
                    </div>
                  </div>
                )}
              </div>

              {/* Settings Group */}
              <div className="flex flex-col gap-4 border-t border-gray-950 pt-4">
                <span className="text-[10px] font-bold text-[#4FACFE] uppercase tracking-widest font-mono">
                  RENDER ENGINE PROPERTIES
                </span>

                <div className="grid grid-cols-2 gap-4">
                  {/* Whisper Transcription Model */}
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="whisperModel" className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                      Speech AI Model
                    </label>
                    <select
                      id="whisperModel"
                      value={whisperModel}
                      onChange={(e) => setWhisperModel(e.target.value)}
                      disabled={isUploading}
                      className="w-full bg-[#030C1B] border border-gray-900 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-[#00F2FE] transition-colors"
                    >
                      <option value="tiny">Tiny (Ultra Fast)</option>
                      <option value="base">Base (Balanced)</option>
                      <option value="small">Small (High Accuracy)</option>
                      <option value="medium">Medium (Server Grade)</option>
                    </select>
                  </div>

                  {/* Aspect Ratio */}
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="aspectRatio" className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                      Output Canvas
                    </label>
                    <select
                      id="aspectRatio"
                      value={aspectRatio}
                      onChange={(e) => setAspectRatio(e.target.value)}
                      disabled={isUploading}
                      className="w-full bg-[#030C1B] border border-gray-900 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-[#00F2FE] transition-colors"
                    >
                      <option value="9:16">9:16 (Vertical Short)</option>
                      <option value="1:1">1:1 (Square Reel)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Target Reels Yield */}
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="numShorts" className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                      Target Reel Count
                    </label>
                    <input
                      id="numShorts"
                      type="number"
                      min={1}
                      max={15}
                      value={numShorts}
                      onChange={(e) => setNumShorts(parseInt(e.target.value) || 5)}
                      disabled={isUploading}
                      className="w-full bg-[#030C1B] border border-gray-900 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-[#00F2FE] font-mono"
                    />
                  </div>

                  {/* Cut Strategy */}
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="strategy" className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                      AI Cut Heuristic
                    </label>
                    <select
                      id="strategy"
                      value={strategy}
                      onChange={(e) => setStrategy(e.target.value)}
                      disabled={isUploading}
                      className="w-full bg-[#030C1B] border border-gray-900 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-[#00F2FE] transition-colors"
                    >
                      <option value="viral">Viral Hooks & Retention</option>
                      <option value="conversational">Long Conversations</option>
                      <option value="fast-paced">Rapid Scene Tempo</option>
                    </select>
                  </div>
                </div>

                {/* Duration inputs */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="minDuration" className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                      Min Duration (s)
                    </label>
                    <input
                      id="minDuration"
                      type="number"
                      min={5}
                      max={60}
                      value={minDuration}
                      onChange={(e) => setMinDuration(parseInt(e.target.value) || 15)}
                      disabled={isUploading}
                      className="w-full bg-[#030C1B] border border-gray-900 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-[#00F2FE] font-mono"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="maxDuration" className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                      Max Duration (s)
                    </label>
                    <input
                      id="maxDuration"
                      type="number"
                      min={10}
                      max={90}
                      value={maxDuration}
                      onChange={(e) => setMaxDuration(parseInt(e.target.value) || 20)}
                      disabled={isUploading}
                      className="w-full bg-[#030C1B] border border-gray-900 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-[#00F2FE] font-mono"
                    />
                  </div>
                </div>

                {/* Force CPU Toggle */}
                <div className="flex items-center gap-2 mt-1">
                  <input
                    id="forceCpu"
                    type="checkbox"
                    checked={forceCpu}
                    onChange={(e) => setForceCpu(e.target.checked)}
                    className="w-4 h-4 rounded text-[#00F2FE] bg-[#030C1B] border-gray-900 focus:ring-0 cursor-pointer"
                    disabled={isUploading}
                  />
                  <label htmlFor="forceCpu" className="text-[10px] text-gray-400 font-semibold cursor-pointer select-none">
                    Force CPU Mode (Bypasses GPU CUDA VRAM allocation)
                  </label>
                </div>
              </div>

              {/* Submit Button & Upload progress */}
              <div className="mt-2 border-t border-gray-950 pt-4">
                {isUploading ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between items-center text-xs font-semibold text-[#00F2FE]">
                      <span>Importing file to local database...</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-gray-950 rounded-full h-2 overflow-hidden border border-gray-900">
                      <div
                        className="bg-gradient-to-r from-[#00F2FE] to-[#4FACFE] h-full rounded-full transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      ></div>
                    </div>
                  </div>
                ) : (
                  <button
                    type="submit"
                    disabled={!file}
                    className={`w-full py-2.5 rounded-lg text-[#030C1B] font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 active:scale-[0.98] transition-all shadow-md ${
                      file 
                        ? "bg-gradient-to-r from-[#00F2FE] to-[#4FACFE] hover:opacity-95 shadow-[#00f2fe22]" 
                        : "bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-900"
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Start Rendering Timeline
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Right Column: Divided Active Stepper status vs History logs (7 cols) */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            
            {/* Panel Tab Header */}
            <div className="flex border-b border-[#0f1d36] bg-[#040E20]/50 rounded-t-xl overflow-hidden select-none">
              <button
                type="button"
                onClick={() => setActiveMonitorTab("monitor")}
                className={`px-4 py-2 text-[10px] font-bold tracking-widest uppercase font-mono border-b-2 transition-all ${
                  activeMonitorTab === "monitor"
                    ? "text-[#00F2FE] border-[#00F2FE] bg-[#081C36]/50"
                    : "text-gray-500 hover:text-white border-transparent"
                }`}
              >
                Live Monitor & Streams
              </button>
              <button
                type="button"
                onClick={() => setActiveMonitorTab("trending")}
                className={`px-4 py-2 text-[10px] font-bold tracking-widest uppercase font-mono border-b-2 transition-all ${
                  activeMonitorTab === "trending"
                    ? "text-[#00F2FE] border-[#00F2FE] bg-[#081C36]/50"
                    : "text-gray-500 hover:text-white border-transparent"
                }`}
              >
                Trending YouTube Analyzer
              </button>
            </div>

            {activeMonitorTab === "trending" ? (
              <div className="bg-[#081C36] border border-[#0f1d36] rounded-b-2xl rounded-tr-2xl p-5 shadow-2xl flex flex-col gap-6 animate-fadeIn">
                {/* Header title */}
                <div className="flex justify-between items-center border-b border-gray-950 pb-3">
                  <div>
                    <h3 className="text-xs font-black text-white flex items-center gap-2 tracking-wider uppercase font-mono">
                      <span className="w-2 h-2 rounded-full bg-[#00F2FE] shrink-0 animate-pulse"></span>
                      YouTube License Scanner
                    </h3>
                    <p className="text-[9px] text-[#4FACFE] mt-0.5 font-mono">Scan YouTube streams for copyright classifications</p>
                  </div>
                  <button
                    type="button"
                    onClick={fetchTrending}
                    className="py-1 px-2.5 rounded bg-gray-950 border border-gray-900 hover:border-gray-800 text-[9px] text-gray-400 hover:text-white font-mono transition-all"
                  >
                    ⟳ Refresh Feed
                  </button>
                </div>

                {/* Search / Scan box */}
                <form onSubmit={handleCheckCopyright} className="flex gap-2 bg-[#030C1B] p-2.5 rounded-lg border border-gray-900 shadow-inner">
                  <input
                    type="text"
                    value={ytCheckUrl}
                    onChange={(e) => setYtCheckUrl(e.target.value)}
                    placeholder="Paste YouTube Link (e.g. https://www.youtube.com/watch?v=kUaKz7B9XnQ)"
                    className="flex-1 bg-black border border-gray-950 rounded p-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-[#00F2FE]/50 font-mono"
                  />
                  <button
                    type="submit"
                    disabled={isCheckingYt || !ytCheckUrl}
                    className="py-1.5 px-3 rounded bg-gradient-to-r from-[#00F2FE] to-[#4FACFE] text-[#030C1B] font-black text-[10px] uppercase tracking-wider hover:opacity-90 transition-all shrink-0 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isCheckingYt ? "Scanning..." : "Scan License"}
                  </button>
                </form>

                {/* Scan Result Badge */}
                {ytCheckResult && (
                  <div className={`p-3 rounded-lg border flex flex-col gap-2.5 animate-slideIn ${
                    ytCheckResult.copyright_free 
                      ? "bg-emerald-950/20 border-emerald-500/20" 
                      : "bg-red-950/20 border-red-500/20"
                  }`}>
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex gap-2">
                        <img 
                          src={ytCheckResult.thumbnail_url} 
                          alt="Thumbnail" 
                          className="w-16 h-10 object-cover rounded border border-gray-900 shrink-0 shadow-md"
                        />
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] font-bold text-white line-clamp-1">{ytCheckResult.title}</span>
                          <span className="text-[9px] text-gray-400 font-mono">{ytCheckResult.channel}</span>
                        </div>
                      </div>
                      <span className={`text-[8px] font-mono py-0.5 px-2 rounded-full border shrink-0 font-bold uppercase tracking-wider ${
                        ytCheckResult.copyright_free
                          ? "bg-emerald-950 text-emerald-400 border-emerald-500/30"
                          : "bg-red-950 text-red-400 border-red-500/30"
                      }`}>
                        {ytCheckResult.copyright_free ? "✓ Copyright Free" : "⚠️ Copyright Restricted"}
                      </span>
                    </div>

                    <div className="text-[10px] leading-relaxed text-gray-300 font-sans border-t border-gray-950 pt-2 flex flex-col gap-1">
                      <div className="flex justify-between font-mono text-[9px]">
                        <span className="text-gray-500">License Tag:</span>
                        <span className={ytCheckResult.copyright_free ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
                          {ytCheckResult.license}
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-400 italic">"{ytCheckResult.reason}"</p>
                    </div>
                  </div>
                )}

                {/* Category Filter Tabs */}
                <div className="flex flex-wrap gap-1.5 border-b border-gray-950 pb-2">
                  {["All", "News", "Podcast", "Famous Creator", "Kids", "Nature"].map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategoryFilter(cat)}
                      className={`py-1 px-2.5 rounded font-mono text-[9px] font-black uppercase tracking-wider transition-all border ${
                        selectedCategoryFilter.toLowerCase() === cat.toLowerCase()
                          ? "bg-[#00F2FE]/15 text-[#00F2FE] border-[#00F2FE]/30 shadow-sm shadow-[#00f2fe11]"
                          : "bg-gray-950 text-gray-500 border-gray-900 hover:text-white"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {/* Categorized Columns Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Copyright Free Category */}
                  <div className="flex flex-col gap-3 bg-[#030C1B] p-3.5 rounded-xl border border-emerald-500/10 shadow-lg">
                    <span className="text-[9px] font-bold text-emerald-400 font-mono uppercase tracking-widest flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      ✓ Copyright Free (CC-BY Reuse Allowed)
                    </span>
                    <div className="flex flex-col gap-2.5 max-h-[300px] overflow-y-auto pr-1">
                      {trendingVideos
                        .filter(v => v.copyright_free)
                        .filter(v => selectedCategoryFilter === "All" || v.category.toLowerCase() === selectedCategoryFilter.toLowerCase())
                        .map(video => (
                          <div key={video.id} className="bg-black/60 p-2 rounded-lg border border-gray-950 hover:border-emerald-500/20 transition-all flex flex-col gap-2">
                            <div className="flex gap-2">
                              <img 
                                src={video.thumbnail_url} 
                                alt={video.title} 
                                className="w-16 h-10 object-cover rounded border border-gray-900 shrink-0" 
                              />
                              <div className="flex flex-col gap-0.5 truncate">
                                <span className="text-[10px] font-bold text-white truncate" title={video.title}>{video.title}</span>
                                <span className="text-[8px] text-gray-500 font-mono truncate">{video.channel}</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between text-[8px] font-mono border-t border-gray-950 pt-1.5 mt-0.5">
                              <div className="flex gap-1.5 items-center">
                                <span className="text-[#00F2FE]">{video.rank}</span>
                                <span className="text-gray-600">|</span>
                                <span className="text-emerald-500/80 font-bold bg-emerald-950/40 px-1 rounded">{video.category}</span>
                              </div>
                              <a 
                                href={video.url} 
                                target="_blank" 
                                rel="noreferrer" 
                                className="text-gray-400 hover:text-white underline cursor-pointer"
                              >
                                Open YouTube ↗
                              </a>
                            </div>
                          </div>
                        ))}
                      {trendingVideos
                        .filter(v => v.copyright_free)
                        .filter(v => selectedCategoryFilter === "All" || v.category.toLowerCase() === selectedCategoryFilter.toLowerCase()).length === 0 && (
                          <div className="py-8 text-center text-xs text-gray-600 font-mono italic">
                            [No matching copyright-free videos found]
                          </div>
                        )}
                    </div>
                  </div>

                  {/* Copyright Restricted Category */}
                  <div className="flex flex-col gap-3 bg-[#030C1B] p-3.5 rounded-xl border border-red-500/10 shadow-lg">
                    <span className="text-[9px] font-bold text-red-400 font-mono uppercase tracking-widest flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"></span>
                      ⚠️ Standard License (Copyright Restricted)
                    </span>
                    <div className="flex flex-col gap-2.5 max-h-[300px] overflow-y-auto pr-1">
                      {trendingVideos
                        .filter(v => !v.copyright_free)
                        .filter(v => selectedCategoryFilter === "All" || v.category.toLowerCase() === selectedCategoryFilter.toLowerCase())
                        .map(video => (
                          <div key={video.id} className="bg-black/60 p-2 rounded-lg border border-gray-950 hover:border-red-500/20 transition-all flex flex-col gap-2">
                            <div className="flex gap-2">
                              <img 
                                src={video.thumbnail_url} 
                                alt={video.title} 
                                className="w-16 h-10 object-cover rounded border border-gray-900 shrink-0" 
                              />
                              <div className="flex flex-col gap-0.5 truncate">
                                <span className="text-[10px] font-bold text-white truncate" title={video.title}>{video.title}</span>
                                <span className="text-[8px] text-gray-500 font-mono truncate">{video.channel}</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between text-[8px] font-mono border-t border-gray-950 pt-1.5 mt-0.5">
                              <div className="flex gap-1.5 items-center">
                                <span className="text-red-400">{video.rank}</span>
                                <span className="text-gray-600">|</span>
                                <span className="text-red-400/80 font-bold bg-red-950/40 px-1 rounded">{video.category}</span>
                              </div>
                              <a 
                                href={video.url} 
                                target="_blank" 
                                rel="noreferrer" 
                                className="text-gray-400 hover:text-white underline cursor-pointer"
                              >
                                Open YouTube ↗
                              </a>
                            </div>
                          </div>
                        ))}
                      {trendingVideos
                        .filter(v => !v.copyright_free)
                        .filter(v => selectedCategoryFilter === "All" || v.category.toLowerCase() === selectedCategoryFilter.toLowerCase()).length === 0 && (
                          <div className="py-8 text-center text-xs text-gray-600 font-mono italic">
                            [No matching copyright-restricted videos found]
                          </div>
                        )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Active processing engine dashboard */}
                {activeJobs.length > 0 ? (
              <div className="bg-[#081C36] border border-[#0f1d36] rounded-b-2xl rounded-tr-2xl p-5 shadow-2xl flex flex-col gap-4">
                <div className="flex justify-between items-center border-b border-gray-950 pb-2.5">
                  <h3 className="text-xs font-black text-white flex items-center gap-2 tracking-wider uppercase font-mono">
                    <span className="w-2 h-2 rounded-full bg-[#00F2FE] animate-pulse shrink-0"></span>
                    Rendering Frame Sequence
                  </h3>
                  <span className="text-[9px] bg-[#00f2fe22] text-[#00F2FE] border border-[#00f2fe44] font-mono py-0.5 px-2 rounded font-bold">
                    ACTIVE PIPELINE SLOTS: 2
                  </span>
                </div>

                {activeJobs.map((job) => {
                  const stages = [
                    { id: 1, label: "Video Analysis", prog: 10, text: "Probing resolution, fps, and audio tracks..." },
                    { id: 2, label: "Audio Extraction", prog: 25, text: "Extracting speech track to mono WAV..." },
                    { id: 3, label: "Whisper Transcription", prog: 50, text: "Running local speech-to-text model..." },
                    { id: 4, label: "Scene Cut Detection", prog: 65, text: "Scanning video scene boundaries..." },
                    { id: 5, label: "AI Selection & Scoring", prog: 75, text: "Ranking clips based on hooks & density..." },
                    { id: 6, label: "Reframing & Encoding", prog: 95, text: "Centering speaker and rendering Shorts..." }
                  ];

                  return (
                    <div key={job.id} className="flex flex-col gap-4 animate-fadeIn">
                      {/* Active File Meta */}
                      <div className="flex justify-between items-start gap-2 bg-[#030C1B] p-3 rounded-xl border border-gray-900">
                        <div className="truncate">
                          <span className="text-[8px] uppercase tracking-widest text-[#4FACFE] font-bold block mb-0.5 font-mono">SEQUENCE SOURCE</span>
                          <h4 className="font-bold text-white text-xs truncate max-w-[290px]" title={job.video_metadata.file_name}>
                            {job.video_metadata.file_name || "Input Video File"}
                          </h4>
                          <span className="text-[9px] font-mono text-gray-500 block uppercase mt-0.5">
                            ID: {job.id} | model: {job.settings?.whisper_model || "base"}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCancelJob(job.id)}
                          className="py-1.5 px-3 bg-red-950/40 border border-red-500/30 hover:bg-red-900/20 text-red-300 rounded-lg text-[9px] font-mono font-bold uppercase transition-all flex items-center gap-1 shadow-sm shrink-0"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          Abort
                        </button>
                      </div>

                      {/* Large Premium Progress Indicator */}
                      <div className="flex flex-col gap-2">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-bold text-[#00F2FE] tracking-wide animate-pulse">
                            {job.status_text}
                          </span>
                          <span className="text-white font-black text-xs bg-gray-900 py-0.5 px-2 rounded font-mono border border-gray-800">
                            {job.progress}%
                          </span>
                        </div>
                        <div className="relative w-full bg-gray-950 rounded-full h-3 border border-gray-900 overflow-hidden">
                          <div
                            className="bg-gradient-to-r from-[#00F2FE] via-[#4FACFE] to-[#00F2FE] h-full rounded-full transition-all duration-500 relative"
                            style={{ width: `${job.progress}%` }}
                          >
                            <div className="absolute right-0 top-0 bottom-0 w-3 bg-white blur-[2px] opacity-40 animate-pulse"></div>
                          </div>
                        </div>
                      </div>

                      {/* Stepper (Fully Visible) */}
                      <div className="flex flex-col gap-2.5 pl-2 mt-1 bg-[#030C1B] p-4 rounded-xl border border-gray-900">
                        <span className="text-[8px] text-[#4FACFE] font-mono uppercase tracking-widest block border-b border-gray-950 pb-1.5 mb-1 font-bold">
                          Timeline Process Stepper
                        </span>
                        {stages.map((stage) => {
                          let stepStatus = "pending";
                          if (job.progress > stage.prog) {
                            stepStatus = "completed";
                          } else if (job.progress === stage.prog || (stage.id === 1 && job.progress < 10)) {
                            stepStatus = "active";
                          } else {
                            const prevStages = stages.filter(s => s.prog < stage.prog);
                            const allPrevDone = prevStages.every(s => job.progress > s.prog);
                            stepStatus = allPrevDone ? "active" : "pending";
                          }

                          return (
                            <div key={stage.id} className="flex gap-3 items-start relative">
                              {stage.id < stages.length && (
                                <div className={`absolute left-2.5 top-6 bottom-0 w-0.5 -ml-px ${
                                  stepStatus === "completed" ? "bg-emerald-500" : "bg-gray-800"
                                }`}></div>
                              )}

                              <div className="relative shrink-0 z-10">
                                {stepStatus === "completed" && (
                                  <div className="w-5 h-5 rounded-full bg-emerald-950 border border-emerald-500 flex items-center justify-center text-emerald-400">
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                    </svg>
                                  </div>
                                )}
                                {stepStatus === "active" && (
                                  <div className="w-5 h-5 rounded-full bg-[#00f2fe22] border border-[#00F2FE] flex items-center justify-center text-[#00F2FE]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#00F2FE] animate-pulse"></span>
                                  </div>
                                )}
                                {stepStatus === "pending" && (
                                  <div className="w-5 h-5 rounded-full bg-gray-950 border border-gray-800 flex items-center justify-center text-gray-600">
                                    <span className="w-1 h-1 rounded-full bg-gray-700"></span>
                                  </div>
                                )}
                              </div>

                              <div className="flex flex-col gap-0.5">
                                <span className={`text-[11px] font-bold ${
                                  stepStatus === "active" ? "text-[#00F2FE]" : stepStatus === "completed" ? "text-gray-400" : "text-gray-600"
                                }`}>
                                  {stage.label}
                                </span>
                                <span className="text-[9px] text-gray-500 leading-tight">
                                  {stepStatus === "active" ? job.status_text : stage.text}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Diagnostic Log Console (Fully Visible) */}
                      <div className="flex flex-col gap-1">
                        <span className="text-[8px] text-gray-500 font-mono uppercase tracking-wider pl-1 font-bold">Active Engine Logs</span>
                        <div className="bg-black border border-gray-900 rounded-lg p-2.5 font-mono text-[9px] text-[#00F2FE] leading-normal h-32 overflow-y-auto shadow-inner flex flex-col gap-1.5">
                          <div>[NEPTUNE CONSOLE - JOB: {job.id}]</div>
                          <div>[SYS_INFO] Target outputs: /shorts/</div>
                          <div>[SYS_INFO] Mode: {job.settings?.force_cpu ? "Force CPU Only" : "Auto-GPU acceleration"}</div>
                          {job.video_metadata?.duration && (
                            <div>
                              [VIDEO_META] File: {job.video_metadata.file_name} ({job.video_metadata.width}x{job.video_metadata.height} | {job.video_metadata.fps} fps | {job.video_metadata.duration.toFixed(1)}s)
                            </div>
                          )}
                          {job.status === "QUEUED" && <div>[INFO] Job queued. Waiting to resolve thread slot...</div>}
                          {job.progress >= 10 && <div>[INFO] Video parsed. Codec details and dimensions verified.</div>}
                          {job.progress >= 25 && <div>[INFO] Audio track separated. Extracting WAV output sample rate: 16000Hz.</div>}
                          {job.progress >= 50 && <div>[INFO] local Whisper loaded. Completed speech-to-text with word-level vectors.</div>}
                          {job.progress >= 65 && <div>[INFO] Video frame analysis complete. Registered scene changes.</div>}
                          {job.progress >= 75 && <div>[INFO] Candidate window selection complete. Selected {job.shorts?.length || job.settings?.num_shorts || 5} clips.</div>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Standby program monitor if no active jobs */
              <div className="bg-[#081C36] border border-[#0f1d36] rounded-b-2xl rounded-tr-2xl p-5 shadow-xl flex flex-col gap-4">
                <div className="flex justify-between items-center border-b border-gray-950 pb-2.5">
                  <h3 className="text-xs font-bold text-gray-400 font-mono tracking-wider uppercase flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-600"></span>
                    Program Monitor (Standby)
                  </h3>
                  <span className="text-[9px] bg-gray-900 border border-gray-800 text-gray-500 font-mono py-0.5 px-2 rounded font-bold">
                    PREVIEW CONTAINER: 1080x1920 (9:16)
                  </span>
                </div>

                <div className="aspect-video bg-black rounded-xl border border-gray-900 relative overflow-hidden flex flex-col items-center justify-center p-4">
                  {/* Viewfinder crosshairs */}
                  <div className="absolute top-3 left-3 w-3 h-3 border-t border-l border-gray-700"></div>
                  <div className="absolute top-3 right-3 w-3 h-3 border-t border-r border-gray-700"></div>
                  <div className="absolute bottom-3 left-3 w-3 h-3 border-b border-l border-gray-700"></div>
                  <div className="absolute bottom-3 right-3 w-3 h-3 border-b border-r border-gray-700"></div>
                  
                  <div className="text-center flex flex-col items-center gap-2 z-10 select-none">
                    <svg className="w-8 h-8 text-gray-800 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <h4 className="text-[10px] font-bold text-gray-500 font-mono tracking-widest uppercase">PROGRAM MONITOR - NO ACTIVE TIMELINE</h4>
                    <p className="text-[9px] text-gray-600 max-w-xs font-sans mt-0.5 leading-normal">Import source media and press "START RENDERING TIMELINE" to spin up the local render node.</p>
                  </div>
                  
                  {/* Timecode clock */}
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 font-mono text-[9px] text-gray-700">
                    00:00:00:00
                  </div>
                  
                  {/* Waveform graphic on bottom */}
                  <div className="absolute bottom-3 left-3 right-3 flex items-end justify-center gap-0.5 h-3 opacity-15">
                    {[3, 5, 8, 12, 18, 15, 10, 6, 4, 3, 5, 12, 22, 19, 14, 8, 4, 2, 5, 9, 11, 8, 3].map((h, i) => (
                      <div key={i} className="w-1 bg-[#00F2FE] rounded-sm" style={{ height: `${h}px` }}></div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Historical list of records */}
            <div className="bg-[#081C36] border border-[#0f1d36] rounded-2xl p-5 shadow-xl flex flex-col gap-4 max-h-[350px]">
              <h3 className="text-xs font-bold text-white flex items-center gap-2 justify-between border-b border-gray-950 pb-2.5">
                <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-gray-400">
                  <svg className="w-4 h-4 text-[#00F2FE]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Render Log History
                </span>
                <span className="text-[9px] bg-gray-900 font-mono px-2 py-0.5 rounded text-gray-500 font-bold border border-gray-800">
                  {completedJobs.length} Records
                </span>
              </h3>

              <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
                {completedJobs.length === 0 ? (
                  <div className="h-28 flex flex-col items-center justify-center text-center text-gray-600 gap-1.5">
                    <svg className="w-6 h-6 text-gray-800" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6M12 9v6m8.955-3.045l-4-4A8.998 8.998 0 0012 3a9 9 0 00-6.955 14.955l4-4a5.002 5.002 0 117.07 0l4 4A8.995 8.995 0 0021.21 15z" />
                    </svg>
                    <p className="text-[10px] font-semibold uppercase tracking-wider">No completed sequences</p>
                  </div>
                ) : (
                  completedJobs.map((job) => {
                    const isExpanded = expandedJobs[job.id] || false;
                    const toggleExpand = () => {
                      setExpandedJobs(prev => ({ ...prev, [job.id]: !prev[job.id] }));
                    };

                    return (
                      <div key={job.id} className="border border-gray-900 bg-[#030C1B]/80 rounded-xl p-3 flex flex-col gap-2 relative overflow-hidden transition-all duration-300">
                        {/* Job Row Header */}
                        <div className="flex justify-between items-center gap-2">
                          <div onClick={toggleExpand} className="cursor-pointer hover:opacity-80 flex-1 truncate">
                            <h4 className="font-bold text-white text-xs truncate max-w-[260px]" title={job.video_metadata.file_name}>
                              {job.video_metadata.file_name || "Input Video File"}
                            </h4>
                            <span className="text-[9px] font-mono text-gray-500 block uppercase mt-0.5">
                              ID: {job.id} | {new Date(job.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <span className={`text-[9px] font-bold uppercase tracking-wider py-0.5 px-2 rounded border ${
                              job.status === "COMPLETED" 
                                ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-400"
                                : "bg-red-950/20 border-red-500/30 text-red-400"
                            }`}>
                              {job.status === "COMPLETED" ? "DONE" : "FAILED"}
                            </span>
                            
                            <button
                              type="button"
                              onClick={() => handleDeleteJobLog(job.id)}
                              className="w-6 h-6 rounded bg-gray-950 border border-gray-900 hover:border-red-500/40 text-gray-500 hover:text-red-400 flex items-center justify-center transition-all shrink-0"
                              title="Delete log record"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Interactive toggle */}
                        <div className="flex items-center justify-between text-[9px] font-mono text-gray-500 border-t border-gray-950 pt-2 mt-1">
                          <button type="button" onClick={toggleExpand} className="hover:text-white transition-all text-left">
                            {isExpanded ? "▼ Hide AI suggestions & logs" : "▶ Show AI suggestions & logs"}
                          </button>
                          <span>{job.shorts?.length || 0} Shorts</span>
                        </div>

                        {/* Expanded details */}
                        {isExpanded && (
                          <div className="flex flex-col gap-3.5 border-t border-gray-950 pt-3.5 mt-1 animate-fadeIn">
                            {job.status === "COMPLETED" && (
                              <div className="flex flex-col gap-2.5 bg-[#00f2fe]/5 border border-[#00f2fe]/10 rounded-lg p-2.5">
                                <span className="text-[9px] font-bold text-[#00F2FE] uppercase tracking-wider flex items-center gap-1">
                                  💡 AI Publisher Insights
                                </span>
                                <div className="text-[10px] text-gray-300 flex flex-col gap-2">
                                  <div className="flex justify-between border-b border-gray-900 pb-1">
                                    <span>Recommended Post Yield:</span>
                                    <span className="text-white font-bold">{Math.max(1, Math.min(job.shorts.length, 3))} Reels</span>
                                  </div>
                                  <div className="flex flex-col gap-1.5">
                                    {job.shorts.map((s) => (
                                      <div key={s.id} className="bg-black/40 p-2 rounded border border-gray-950 flex flex-col gap-0.5">
                                        <div className="flex justify-between text-white font-bold">
                                          <span className="truncate max-w-[210px]">{s.title}</span>
                                          <span className="text-[8px] text-gray-500 font-mono">Score: {s.score}</span>
                                        </div>
                                        <span className="text-[9px] text-gray-400">Concept: "{s.reason}"</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}

                            {job.status === "FAILED" && (
                              <div className="bg-red-950/20 border border-red-500/20 text-red-400 text-[10px] p-2.5 rounded-lg leading-normal">
                                <p className="font-bold">Error Trace:</p>
                                <p className="text-gray-400 font-mono text-[9px] mt-0.5 break-words">{job.error}</p>
                              </div>
                            )}

                            {/* Dev Console Log window */}
                            <div className="flex flex-col gap-1">
                              <span className="text-[8px] text-gray-500 font-mono uppercase tracking-widest pl-1">Historical Execution Log</span>
                              <div className="bg-black border border-gray-950 rounded-lg p-2 font-mono text-[8px] text-[#00F2FE] leading-normal h-24 overflow-y-auto shadow-inner flex flex-col gap-1">
                                <div>[NEPTUNE CONSOLE HISTORY - JOB {job.id}]</div>
                                <div>[SYS_INFO] Status: {job.status}</div>
                                {job.status === "COMPLETED" ? (
                                  <>
                                    <div className="text-emerald-400 font-bold">[COMPLETED] Process ended successfully.</div>
                                    {job.shorts.map(s => (
                                      <div key={s.id} className="text-emerald-500/80 pl-1.5">- {s.filename} ({s.duration}s)</div>
                                    ))}
                                  </>
                                ) : (
                                  <div className="text-red-500">[ERROR] {job.error}</div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* System Spec Diagnostics Card */}
            <div className="bg-[#081C36] border border-[#0f1d36] rounded-2xl p-4.5 shadow-xl flex flex-col gap-3">
              <h3 className="text-xs font-bold text-white flex items-center gap-2 border-b border-gray-950 pb-2.5 font-mono uppercase tracking-wider text-gray-400">
                <svg className="w-4 h-4 text-[#00F2FE]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 5h10a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2-2V7a2 2 0 012-2z" />
                </svg>
                System Compute Diagnostics
              </h3>

              {hardware ? (
                <div className="grid grid-cols-2 gap-3 text-[10px] font-mono">
                  <div className="bg-[#030C1B] p-2 rounded-lg border border-gray-900 flex flex-col gap-0.5">
                    <span className="text-gray-500 uppercase tracking-widest text-[8px]">Processor OS</span>
                    <span className="text-white font-bold capitalize">{hardware.os}</span>
                  </div>

                  <div className="bg-[#030C1B] p-2 rounded-lg border border-gray-900 flex flex-col gap-0.5">
                    <span className="text-gray-500 uppercase tracking-widest text-[8px]">System RAM</span>
                    <span className="text-white font-bold">{hardware.ram_gb} GB</span>
                  </div>

                  <div className="bg-[#030C1B] p-2 rounded-lg border border-gray-900 flex flex-col gap-0.5">
                    <span className="text-gray-500 uppercase tracking-widest text-[8px]">CPU Threads</span>
                    <span className="text-white font-bold">{hardware.cpu_count} cores</span>
                  </div>

                  <div className="bg-[#030C1B] p-2 rounded-lg border border-gray-900 flex flex-col gap-0.5">
                    <span className="text-gray-500 uppercase tracking-widest text-[8px]">Active Device</span>
                    <span className={`font-bold uppercase ${hardware.device === "cuda" ? "text-[#00F2FE]" : "text-yellow-500"}`}>
                      {hardware.device === "cuda" ? "CUDA GPU" : "CPU ONLY"}
                    </span>
                  </div>

                  {hardware.cuda_available && (
                    <div className="col-span-2 bg-[#030C1B] p-2 rounded-lg border border-gray-900 flex flex-col gap-0.5">
                      <span className="text-gray-500 uppercase tracking-widest text-[8px]">Detected Graphics Card</span>
                      <span className="text-[#00F2FE] font-bold text-xs truncate" title={hardware.cuda_device_name || ""}>
                        {hardware.cuda_device_name} ({hardware.cuda_vram_gb} GB VRAM)
                      </span>
                    </div>
                  )}

                  <div className="col-span-2 flex items-center justify-between text-[9px] text-gray-600 pt-0.5">
                    <span>Compute precision: {hardware.compute_type}</span>
                    <span>Thread Pools: Safe</span>
                  </div>
                </div>
              ) : (
                <div className="py-2 text-center text-[10px] text-gray-600 font-mono">
                  [Querying hardware details...]
                </div>
              )}
            </div>
          </>
        )}
      </div>
        </div>

        {/* Bottom Section: Generated Shorts List */}
        <div className="border-t border-[#081C36] pt-8 flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <svg className="w-6 h-6 text-[#00F2FE]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                </svg>
                Generated Shorts Library
              </h2>
              <p className="text-xs text-[#4FACFE] mt-1 font-medium">Rendered vertical 9:16 segments ready for YouTube upload</p>
            </div>
            
            <button
              onClick={fetchShorts}
              className="py-2 px-4 rounded-lg bg-[#081C36] hover:bg-[#2e3c4e] text-white border border-[#4FACFE] border-opacity-20 text-xs font-semibold flex items-center gap-1.5 transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 15H9m5.586-3.092A4 4 0 1014 8h-4" />
              </svg>
              Refresh Library
            </button>
          </div>

          {shorts.length === 0 ? (
            <div className="bg-[#081C36] bg-opacity-40 border border-[#081C36] rounded-2xl p-16 text-center text-[#4FACFE] flex flex-col items-center justify-center gap-3">
              <div className="w-16 h-16 rounded-full bg-[#081C36] flex items-center justify-center text-[#00F2FE] mb-2 shadow-inner">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <h4 className="text-white font-bold text-lg">No shorts generated yet</h4>
              <p className="text-sm max-w-md text-gray-500">
                Once a background job finishes, your generated YouTube Shorts will appear here. Start by uploading a video above.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
              {shorts.map((short) => (
                <div key={short.id} className="bg-[#081C36] border border-[#081C36] hover:border-gray-800 rounded-2xl overflow-hidden flex flex-col shadow-xl transition-all duration-300 group hover:shadow-2xl hover:-translate-y-1">
                  
                  {/* Aspect Ratio Video Frame */}
                  <div className="relative aspect-[9/16] bg-black overflow-hidden flex items-center justify-center">
                    
                    {/* HTML5 Native Video Tag for direct preview */}
                    <video
                      src={`${BACKEND_URL}${short.video_url}`}
                      controls
                      preload="metadata"
                      className="w-full h-full object-cover"
                      poster=""
                    />

                    {/* AI Score Badge overlay */}
                    <div className="absolute top-4 left-4 z-10 flex items-center gap-1 bg-[#030C1B] bg-opacity-80 backdrop-blur border border-[#00f2fe33] py-1 px-2.5 rounded-full">
                      <span className="text-[10px] text-[#00F2FE] font-black tracking-widest uppercase">Score</span>
                      <span className="text-xs text-white font-black">{short.score}/100</span>
                    </div>

                    {/* Timestamp label */}
                    <div className="absolute bottom-4 right-4 z-10 bg-black bg-opacity-75 py-1 px-2 rounded font-mono text-[10px] text-white tracking-wide">
                      {formatSeconds(short.start)} – {formatSeconds(short.end)} ({short.duration.toFixed(1)}s)
                    </div>
                  </div>

                  {/* Card Details */}
                  <div className="p-4 flex-1 flex flex-col justify-between gap-4 bg-[#081C36]">
                    <div className="flex flex-col gap-2">
                      {/* AI Short Title */}
                      <div className="text-sm font-bold text-white tracking-wide truncate mb-1" title={short.title || "AI Short"}>
                        {short.title || "AI Short"}
                      </div>
                      
                      <div className="flex items-start gap-1.5 text-[10px] text-[#00F2FE] font-semibold uppercase tracking-wider">
                        <svg className="w-3.5 h-3.5 shrink-0 text-[#00F2FE]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                        <span>Concept:</span>
                      </div>
                      <p className="text-xs text-gray-400 italic leading-relaxed">
                        "{short.reason}"
                      </p>
                      
                      <div className="border-t border-[#030C1B] my-1"></div>
                      
                      <div className="flex items-start gap-1 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                        <span>Transcript:</span>
                      </div>
                      <p className="text-xs text-white leading-relaxed line-clamp-3 select-text" title={short.transcript}>
                        {short.transcript}
                      </p>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2 items-center mt-2 border-t border-[#030C1B] pt-4">
                      {/* Direct Local Download */}
                      <a
                        href={`${BACKEND_URL}${short.video_url}`}
                        download={short.filename}
                        className="flex-1 py-2 px-3 rounded-lg bg-gradient-to-r from-[#00F2FE] to-[#4FACFE] text-[#030C1B] hover:opacity-90 font-bold text-xs text-center flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download
                      </a>
                      
                      {/* Delete */}
                      <button
                        onClick={() => handleDeleteShort(short.filename)}
                        className="py-2 px-2.5 rounded-lg border border-red-900 bg-red-950 bg-opacity-20 hover:bg-red-950 text-red-400 hover:text-red-200 transition-all active:scale-[0.98]"
                        title="Delete Short"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>

                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </main>

      {/* Footer */}
      <footer className="border-t border-[#081C36] bg-[#030C1B] py-6 text-center text-xs text-gray-600 font-medium">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between px-8 gap-3">
          <p>© 2026 Neptune Shorts. All processing runs 100% locally on your machine.</p>
          <div className="flex gap-4">
            <span className="hover:text-white cursor-help">Local Storage Folder: shorts/</span>
          </div>
        </div>
      </footer>

      {/* Floating Toast Notification Stack */}
      <div className="fixed bottom-6 right-6 z-[999] flex flex-col gap-3 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto p-4 rounded-xl border backdrop-blur-md bg-opacity-95 shadow-xl flex items-start gap-3 transition-all duration-300 transform translate-y-0 animate-slideIn ${
              toast.type === "success"
                ? "bg-emerald-950/95 border-emerald-500/40 text-emerald-100"
                : toast.type === "error"
                  ? "bg-red-950/95 border-red-500/40 text-red-100"
                  : "bg-blue-950/95 border-blue-500/40 text-blue-100"
            }`}
          >
            {/* Status Icons */}
            <div className="shrink-0 mt-0.5">
              {toast.type === "success" && (
                <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              {toast.type === "error" && (
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              {toast.type === "info" && (
                <svg className="w-5 h-5 text-[#00F2FE]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </div>
            {/* Content text */}
            <div className="flex-1">
              <h5 className="font-bold text-xs uppercase tracking-wider">{toast.title}</h5>
              <p className="text-[11px] text-gray-300 mt-0.5 leading-normal">{toast.message}</p>
            </div>
            {/* Close Button */}
            <button
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              className="text-gray-500 hover:text-white shrink-0 text-sm font-bold pl-2"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Custom Confirmation Modal */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-[#081C36] border border-[#00F2FE]/30 rounded-2xl max-w-sm w-full p-5 shadow-2xl shadow-[#00f2fe11] flex flex-col gap-4 animate-slideIn">
            <div className="flex items-center gap-2 text-white border-b border-gray-950 pb-3">
              <svg className="w-5 h-5 text-yellow-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <h3 className="font-bold text-xs uppercase tracking-wider font-mono text-white">{confirmModal.title}</h3>
            </div>
            
            <p className="text-[11px] text-gray-300 leading-relaxed font-sans">{confirmModal.message}</p>
            
            <div className="flex gap-2.5 justify-end mt-2">
              <button
                type="button"
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                className="py-1.5 px-3 rounded bg-gray-950 border border-gray-900 hover:border-gray-800 text-gray-400 hover:text-white text-[10px] font-bold uppercase tracking-wider transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmModal.onConfirm}
                className="py-1.5 px-3 rounded bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white text-[10px] font-black uppercase tracking-wider transition-all shadow-md shadow-red-900/10"
              >
                Confirm Action
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

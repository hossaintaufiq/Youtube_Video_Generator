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
  shorts: ShortClip[];
  created_at: string;
}

export default function App() {
  // Input states
  const [file, setFile] = useState<File | null>(null);
  const [numShorts, setNumShorts] = useState<number>(5);
  const [duration, setDuration] = useState<string>("15-20");
  const [aspectRatio, setAspectRatio] = useState<string>("9:16");
  
  // App states
  const [jobs, setJobs] = useState<Job[]>([]);
  const [shorts, setShorts] = useState<ShortClip[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  
  // Drag & drop state
  const [isDragging, setIsDragging] = useState(false);
  
  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Poll intervals
  useEffect(() => {
    fetchJobs();
    fetchShorts();
    
    const interval = setInterval(() => {
      fetchJobs();
      fetchShorts();
    }, 2000);
    
    return () => clearInterval(interval);
  }, []);

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/jobs`);
      if (res.ok) {
        const data = await res.json();
        setJobs(data);
      }
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    }
  };

  const fetchShorts = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/shorts`);
      if (res.ok) {
        const data = await res.json();
        setShorts(data);
      }
    } catch (err) {
      console.error("Failed to fetch shorts:", err);
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
    setErrorMsg(null);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      validateAndSetFile(droppedFile);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg(null);
    if (e.target.files && e.target.files.length > 0) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (selectedFile: File) => {
    const ext = selectedFile.name.substring(selectedFile.name.lastIndexOf(".")).toLowerCase();
    const validExtensions = [".mp4", ".mov", ".mkv", ".avi", ".webm"];
    
    if (!validExtensions.includes(ext)) {
      setErrorMsg(`Unsupported file type: ${ext}. Please upload MP4, MOV, MKV, AVI or WebM.`);
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
    setErrorMsg(null);
    setSuccessMsg(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("num_shorts", numShorts.toString());
    formData.append("duration", duration);
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
        setSuccessMsg(`Video uploaded successfully! Running job: ${response.job_id}`);
        setFile(null); // Clear input
        if (fileInputRef.current) fileInputRef.current.value = "";
        fetchJobs();
      } else {
        try {
          const errData = JSON.parse(xhr.responseText);
          setErrorMsg(errData.detail || "Upload failed. Please try again.");
        } catch {
          setErrorMsg("Upload failed. Make sure the backend server is running.");
        }
      }
    };

    xhr.onerror = () => {
      setIsUploading(false);
      setErrorMsg("Network error. Unable to connect to local server.");
    };

    xhr.send(formData);
  };

  // Delete Short
  const handleDeleteShort = async (filename: string) => {
    if (!window.confirm(`Are you sure you want to delete this short: ${filename}?`)) {
      return;
    }
    
    try {
      const res = await fetch(`${BACKEND_URL}/api/shorts/${filename}`, {
        method: "DELETE"
      });
      if (res.ok) {
        setSuccessMsg(`Deleted short: ${filename}`);
        fetchShorts();
      } else {
        const err = await res.json();
        setErrorMsg(err.detail || "Failed to delete short.");
      }
    } catch {
      setErrorMsg("Error communicating with local server to delete short.");
    }
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

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0C10] text-[#C5C6C7]">
      {/* Premium Header */}
      <header className="border-b border-[#1F2833] bg-[#0B0C10] py-6 px-8 sticky top-0 z-50 backdrop-blur-md bg-opacity-80">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-tr from-[#66FCF1] to-[#45A29E] flex items-center justify-center text-[#0B0C10] font-black text-xl shadow-lg shadow-[#66fcf122]">
              AG
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-wider text-white">ANTIGRAVITY AI</h1>
              <p className="text-[10px] text-[#45A29E] font-semibold uppercase tracking-widest">Local Shorts Generator</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-xs text-[#66FCF1] bg-[#66fcf111] py-1 px-3 rounded-full border border-[#66fcf133] font-semibold">
              <span className="w-2 h-2 rounded-full bg-[#66FCF1] animate-pulse"></span>
              Local Server Active
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 flex flex-col gap-8">
        
        {/* Alert Notifications */}
        {errorMsg && (
          <div className="p-4 bg-red-950 border border-red-500 rounded-xl text-red-200 flex items-start gap-3 shadow-lg">
            <svg className="w-5 h-5 text-red-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <h4 className="font-bold">Error Occurred</h4>
              <p className="text-sm">{errorMsg}</p>
            </div>
            <button className="ml-auto text-red-400 hover:text-red-200" onClick={() => setErrorMsg(null)}>×</button>
          </div>
        )}

        {successMsg && (
          <div className="p-4 bg-emerald-950 border border-emerald-500 rounded-xl text-emerald-200 flex items-start gap-3 shadow-lg">
            <svg className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h4 className="font-bold">Success</h4>
              <p className="text-sm">{successMsg}</p>
            </div>
            <button className="ml-auto text-emerald-400 hover:text-emerald-200" onClick={() => setSuccessMsg(null)}>×</button>
          </div>
        )}

        {/* Dashboard Grid (Inputs / Settings vs Processing Jobs) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left Column: Upload & Settings (7 cols) */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            
            {/* Input Form Card */}
            <form onSubmit={handleGenerateShorts} className="bg-[#1F2833] border border-[#1F2833] rounded-2xl p-6 shadow-xl flex flex-col gap-6">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-[#66FCF1]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                1. Select Local Video Source
              </h3>

              {/* Drag & Drop File Picker */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-300 ${
                  isDragging 
                    ? "border-[#66FCF1] bg-[#66fcf108] scale-[0.99]" 
                    : file 
                      ? "border-emerald-500 bg-emerald-950/10" 
                      : "border-[#45A29E] hover:border-[#66FCF1] bg-[#0B0C10]"
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
                    <div className="w-14 h-14 rounded-full bg-emerald-950 border border-emerald-500 flex items-center justify-center text-emerald-400 mb-2">
                      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                    </div>
                    <h4 className="text-white font-semibold truncate max-w-md">{file.name}</h4>
                    <div className="flex gap-4 text-xs text-[#45A29E] font-medium mt-1">
                      <span>Size: {formatBytes(file.size)}</span>
                      <span>Format: {file.name.substring(file.name.lastIndexOf(".")).toUpperCase()}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-14 h-14 rounded-full bg-[#1F2833] flex items-center justify-center text-[#66FCF1] mb-1">
                      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-white font-medium text-sm">Drag & Drop video file here</p>
                      <p className="text-[#45A29E] text-xs mt-1">or click to browse local files</p>
                    </div>
                    <div className="mt-2 text-[10px] text-gray-500 font-mono">
                      Supported: MP4, MOV, MKV, AVI, WebM
                    </div>
                  </div>
                )}
              </div>

              {/* Settings Group */}
              <div className="flex flex-col gap-4 border-t border-[#0B0C10] pt-5">
                <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-2">
                  <svg className="w-5 h-5 text-[#66FCF1]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                  </svg>
                  2. Configuration Options
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Number of shorts */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-white uppercase tracking-wider">Number of Shorts</label>
                    <select
                      value={numShorts}
                      onChange={(e) => setNumShorts(Number(e.target.value))}
                      className="bg-[#0B0C10] border border-[#45A29E] border-opacity-30 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-[#66FCF1]"
                      disabled={isUploading}
                    >
                      <option value={1}>1 Short</option>
                      <option value={3}>3 Shorts</option>
                      <option value={5}>5 Shorts (Recommended)</option>
                      <option value={10}>10 Shorts</option>
                    </select>
                  </div>

                  {/* Target duration */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-white uppercase tracking-wider">Short Duration</label>
                    <select
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                      className="bg-[#0B0C10] border border-[#45A29E] border-opacity-30 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-[#66FCF1]"
                      disabled={isUploading}
                    >
                      <option value="15-20">15 – 20 seconds (Standard)</option>
                    </select>
                  </div>

                  {/* Aspect Ratio */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-white uppercase tracking-wider">Aspect Ratio</label>
                    <select
                      value={aspectRatio}
                      onChange={(e) => setAspectRatio(e.target.value)}
                      className="bg-[#0B0C10] border border-[#45A29E] border-opacity-30 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-[#66FCF1]"
                      disabled={isUploading}
                    >
                      <option value="9:16">9:16 Vertical (1080 × 1920)</option>
                    </select>
                  </div>

                  {/* Subtitle presets */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-white uppercase tracking-wider">Subtitles Styling</label>
                    <input
                      type="text"
                      value="Impact, Bold, Word Highlight (Yellow)"
                      disabled
                      className="bg-[#0B0C10] border border-gray-800 rounded-lg p-2.5 text-sm text-gray-500 cursor-not-allowed"
                    />
                  </div>
                </div>
              </div>

              {/* Submit Button & Upload progress */}
              <div className="mt-2">
                {isUploading ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between items-center text-xs font-semibold text-[#66FCF1]">
                      <span>Uploading to local processor...</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-[#0B0C10] rounded-full h-3 overflow-hidden border border-[#45A29E] border-opacity-20">
                      <div
                        className="bg-gradient-to-r from-[#66FCF1] to-[#45A29E] h-full rounded-full transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      ></div>
                    </div>
                  </div>
                ) : (
                  <button
                    type="submit"
                    disabled={!file}
                    className={`w-full py-4 px-6 rounded-xl font-bold tracking-wider uppercase text-sm transition-all duration-300 flex items-center justify-center gap-2 ${
                      file 
                        ? "bg-gradient-to-r from-[#66FCF1] to-[#45A29E] text-black hover:opacity-90 active:scale-[0.98] shadow-lg shadow-[#66fcf11a]" 
                        : "bg-gray-800 text-gray-500 cursor-not-allowed"
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Generate Shorts
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Right Column: Processing Pipeline & Jobs List (5 cols) */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            <div className="bg-[#1F2833] border border-[#1F2833] rounded-2xl p-6 shadow-xl flex flex-col gap-4 max-h-[580px]">
              <h3 className="text-lg font-bold text-white flex items-center gap-2 justify-between border-b border-[#0B0C10] pb-3">
                <span className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-[#66FCF1]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 15H9m5.586-3.092A4 4 0 1014 8h-4" />
                  </svg>
                  Pipeline Progress
                </span>
                <span className="text-xs bg-gray-900 font-mono px-2 py-0.5 rounded text-gray-400">
                  {jobs.length} Jobs
                </span>
              </h3>

              <div className="flex-1 overflow-y-auto flex flex-col gap-4 pr-1">
                {jobs.length === 0 ? (
                  <div className="h-48 flex flex-col items-center justify-center text-center text-[#45A29E] gap-2">
                    <svg className="w-10 h-10 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                    </svg>
                    <p className="text-sm font-medium">No processing jobs active.</p>
                    <p className="text-xs text-gray-500">Upload a video file to run the local pipeline.</p>
                  </div>
                ) : (
                  jobs.map((job) => (
                    <div key={job.id} className="border border-gray-800 bg-[#0B0C10] rounded-xl p-4 flex flex-col gap-3 relative overflow-hidden">
                      {/* Job Header */}
                      <div className="flex justify-between items-start gap-2">
                        <div className="truncate">
                          <h4 className="font-bold text-white text-sm truncate max-w-[180px]">
                            {job.video_metadata.file_name || "Input Video File"}
                          </h4>
                          <span className="text-[10px] font-mono text-gray-500 block uppercase">
                            Job ID: {job.id} | {new Date(job.created_at).toLocaleTimeString()}
                          </span>
                        </div>
                        <span className={`text-[10px] font-bold uppercase tracking-wider py-0.5 px-2 rounded-full border ${
                          job.status === "COMPLETED" 
                            ? "bg-emerald-950 border-emerald-500 text-emerald-300"
                            : job.status === "FAILED"
                              ? "bg-red-950 border-red-500 text-red-300"
                              : "bg-[#66fcf111] border-[#66FCF1] text-[#66FCF1]"
                        }`}>
                          {job.status}
                        </span>
                      </div>

                      {/* Job Progress Indicator */}
                      {job.status === "PROCESSING" && (
                        <div className="flex flex-col gap-1.5 mt-1">
                          <div className="flex justify-between text-xs text-gray-400 font-medium">
                            <span className="truncate max-w-[200px]">{job.status_text}</span>
                            <span>{job.progress}%</span>
                          </div>
                          <div className="w-full bg-gray-900 rounded-full h-2 overflow-hidden border border-gray-800">
                            <div
                              className="bg-[#66FCF1] h-full rounded-full transition-all duration-500"
                              style={{ width: `${job.progress}%` }}
                            ></div>
                          </div>
                        </div>
                      )}

                      {job.status === "QUEUED" && (
                        <div className="flex items-center gap-2 text-xs text-yellow-400 font-medium bg-yellow-950/20 border border-yellow-900/50 p-2 rounded-lg">
                          <span className="w-2 h-2 rounded-full bg-yellow-400 animate-ping"></span>
                          <span>In local queue...</span>
                        </div>
                      )}

                      {job.status === "COMPLETED" && (
                        <div className="flex items-center gap-2 text-xs text-emerald-400 font-medium bg-emerald-950/20 border border-emerald-900/50 p-2.5 rounded-lg">
                          <svg className="w-4 h-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>Generated {job.shorts.length} Shorts successfully.</span>
                        </div>
                      )}

                      {job.status === "FAILED" && (
                        <div className="flex items-start gap-2 text-xs text-red-400 font-medium bg-red-950/20 border border-red-900/50 p-2.5 rounded-lg">
                          <svg className="w-4 h-4 shrink-0 text-red-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <div>
                            <p className="font-bold">Generation failed</p>
                            <p className="text-gray-500 font-mono text-[10px] break-all leading-tight mt-1">{job.error}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

        </div>

        {/* Bottom Section: Generated Shorts List */}
        <div className="border-t border-[#1F2833] pt-8 flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <svg className="w-6 h-6 text-[#66FCF1]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                </svg>
                Generated Shorts Library
              </h2>
              <p className="text-xs text-[#45A29E] mt-1 font-medium">Rendered vertical 9:16 segments ready for YouTube upload</p>
            </div>
            
            <button
              onClick={fetchShorts}
              className="py-2 px-4 rounded-lg bg-[#1F2833] hover:bg-[#2e3c4e] text-white border border-[#45A29E] border-opacity-20 text-xs font-semibold flex items-center gap-1.5 transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 15H9m5.586-3.092A4 4 0 1014 8h-4" />
              </svg>
              Refresh Library
            </button>
          </div>

          {shorts.length === 0 ? (
            <div className="bg-[#1F2833] bg-opacity-40 border border-[#1F2833] rounded-2xl p-16 text-center text-[#45A29E] flex flex-col items-center justify-center gap-3">
              <div className="w-16 h-16 rounded-full bg-[#1F2833] flex items-center justify-center text-[#66FCF1] mb-2 shadow-inner">
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
                <div key={short.id} className="bg-[#1F2833] border border-[#1F2833] hover:border-gray-800 rounded-2xl overflow-hidden flex flex-col shadow-xl transition-all duration-300 group hover:shadow-2xl hover:-translate-y-1">
                  
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
                    <div className="absolute top-4 left-4 z-10 flex items-center gap-1 bg-[#0B0C10] bg-opacity-80 backdrop-blur border border-[#66fcf133] py-1 px-2.5 rounded-full">
                      <span className="text-[10px] text-[#66FCF1] font-black tracking-widest uppercase">Score</span>
                      <span className="text-xs text-white font-black">{short.score}/100</span>
                    </div>

                    {/* Timestamp label */}
                    <div className="absolute bottom-4 right-4 z-10 bg-black bg-opacity-75 py-1 px-2 rounded font-mono text-[10px] text-white tracking-wide">
                      {formatSeconds(short.start)} – {formatSeconds(short.end)} ({short.duration.toFixed(1)}s)
                    </div>
                  </div>

                  {/* Card Details */}
                  <div className="p-4 flex-1 flex flex-col justify-between gap-4 bg-[#1F2833]">
                    <div className="flex flex-col gap-2">
                      {/* AI Short Title */}
                      <div className="text-sm font-bold text-white tracking-wide truncate mb-1" title={short.title || "AI Short"}>
                        {short.title || "AI Short"}
                      </div>
                      
                      <div className="flex items-start gap-1.5 text-[10px] text-[#66FCF1] font-semibold uppercase tracking-wider">
                        <svg className="w-3.5 h-3.5 shrink-0 text-[#66FCF1]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                        <span>Concept:</span>
                      </div>
                      <p className="text-xs text-gray-400 italic leading-relaxed">
                        "{short.reason}"
                      </p>
                      
                      <div className="border-t border-[#0B0C10] my-1"></div>
                      
                      <div className="flex items-start gap-1 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                        <span>Transcript:</span>
                      </div>
                      <p className="text-xs text-white leading-relaxed line-clamp-3 select-text" title={short.transcript}>
                        {short.transcript}
                      </p>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2 items-center mt-2 border-t border-[#0B0C10] pt-4">
                      {/* Direct Local Download */}
                      <a
                        href={`${BACKEND_URL}${short.video_url}`}
                        download={short.filename}
                        className="flex-1 py-2 px-3 rounded-lg bg-gradient-to-r from-[#66FCF1] to-[#45A29E] text-black hover:opacity-90 font-bold text-xs text-center flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all"
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
      <footer className="border-t border-[#1F2833] bg-[#0B0C10] py-6 text-center text-xs text-gray-600 font-medium">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between px-8 gap-3">
          <p>© 2026 Antigravity AI. All processing runs 100% locally on your machine.</p>
          <div className="flex gap-4">
            <span className="hover:text-white cursor-help">Local Storage Folder: shorts_output/</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

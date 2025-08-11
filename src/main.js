import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

class AudioExtractionDemo {
    constructor() {
        this.ffmpeg = null;
        this.currentFile = null;
        this.networkSpeed = null;
        this.clientExtractSpeed = 2; // Default: 2x realtime
        this.serverExtractSpeed = 10; // Default: 10x realtime
        this.extractedAudioBlob = null; // Store extracted audio for playback
        this.extractedAudioUrl = null; // Store audio URL for cleanup
        this.stepTimings = {}; // Track timing for each step
        
        this.init();
    }

    async init() {
        this.setupUI();
        await this.loadFFmpeg();
        this.measureNetworkSpeed();
        this.setupEventListeners();
    }

    async loadFFmpeg() {
        try {
            const statusEl = document.getElementById('ffmpeg-status');
            statusEl.textContent = 'Loading FFmpeg.wasm...';
            
            this.ffmpeg = new FFmpeg();
            
            const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
            await this.ffmpeg.load({
                coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
                wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
            });
            
            statusEl.textContent = 'FFmpeg.wasm loaded successfully';
            statusEl.style.color = '#4ade80';
        } catch (error) {
            console.error('Failed to load FFmpeg:', error);
            document.getElementById('ffmpeg-status').textContent = 'FFmpeg.wasm failed to load';
        }
    }

    async measureNetworkSpeed() {
        const testSize = 1024 * 1024; // 1MB test
        const testData = new Uint8Array(testSize);
        const blob = new Blob([testData]);
        
        const startTime = performance.now();
        
        try {
            // Simulate upload to measure speed
            const formData = new FormData();
            formData.append('test', blob);
            
            await fetch('http://localhost:3000/speed-test', {
                method: 'POST',
                body: formData
            });
            
            const endTime = performance.now();
            const duration = (endTime - startTime) / 1000; // seconds
            const speedMbps = (testSize * 8) / (duration * 1000000);
            
            this.networkSpeed = speedMbps;
            this.updateNetworkInfo(speedMbps);
        } catch (error) {
            console.log('Speed test failed, using default estimate');
            this.networkSpeed = 10; // Default to 10 Mbps
            this.updateNetworkInfo(10);
        }
    }

    updateNetworkInfo(speed) {
        document.getElementById('upload-speed').textContent = speed.toFixed(1);
        document.getElementById('network-status').textContent = 
            speed > 50 ? 'Excellent' : speed > 20 ? 'Good' : speed > 5 ? 'Fair' : 'Poor';
        
        this.calculateOptimalStrategy();
    }

    calculateOptimalStrategy() {
        if (!this.currentFile) return;
        
        const videoBitrate = 8; // Mbps
        const audioBitrate = 0.128; // Mbps
        const duration = 20 * 60; // 20 minutes in seconds
        
        const videoSize = (videoBitrate * duration) / 8; // MB
        const audioSize = (audioBitrate * duration) / 8; // MB
        
        // Calculate times for each path
        const clientExtractTime = duration / (this.clientExtractSpeed * 60); // minutes
        const serverExtractTime = duration / (this.serverExtractSpeed * 60); // minutes
        
        const videoUploadTime = (videoSize * 8) / (this.networkSpeed * 60); // minutes
        const audioUploadTime = (audioSize * 8) / (this.networkSpeed * 60); // minutes
        
        const clientPath = clientExtractTime + audioUploadTime;
        const serverPath = videoUploadTime + serverExtractTime;
        
        const threshold = (videoBitrate - audioBitrate) / 
            ((1/this.clientExtractSpeed) - (1/this.serverExtractSpeed));
        
        document.getElementById('threshold-speed').textContent = threshold.toFixed(1);
        document.getElementById('decision-result').textContent = 
            this.networkSpeed < threshold ? 
            'Client-side extraction is faster' : 
            'Server-side extraction is faster';
        
        // Update UI recommendations
        const clientCard = document.getElementById('client-strategy');
        const serverCard = document.getElementById('server-strategy');
        
        if (clientPath < serverPath) {
            clientCard.classList.add('recommended');
            serverCard.classList.remove('recommended');
        } else {
            serverCard.classList.add('recommended');
            clientCard.classList.remove('recommended');
        }
        
        // Update time estimates
        document.getElementById('client-time').textContent = clientPath.toFixed(2);
        document.getElementById('server-time').textContent = serverPath.toFixed(2);
    }

    setupEventListeners() {
        const fileInput = document.getElementById('file-input');
        const dropZone = document.getElementById('drop-zone');
        
        fileInput.addEventListener('change', (e) => this.handleFileSelect(e.target.files[0]));
        
        dropZone.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            this.handleFileSelect(e.dataTransfer.files[0]);
        });
        
        document.getElementById('run-client').addEventListener('click', () => this.runClientExtraction());
        document.getElementById('run-server').addEventListener('click', () => this.runServerExtraction());
        
        // Threshold calculator inputs
        ['video-bitrate', 'audio-bitrate', 'client-speed', 'server-speed'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => this.updateThresholdCalculation());
        });
    }

    handleFileSelect(file) {
        if (!file || !file.type.startsWith('video/')) {
            alert('Please select a video file');
            return;
        }
        
        this.currentFile = file;
        
        document.getElementById('file-info').innerHTML = `
            <div><strong>File:</strong> ${file.name}</div>
            <div><strong>Size:</strong> ${(file.size / (1024*1024)).toFixed(2)} MB</div>
            <div><strong>Type:</strong> ${file.type}</div>
        `;
        
        this.calculateOptimalStrategy();
    }

    async runClientExtraction() {
        if (!this.currentFile || !this.ffmpeg) {
            alert('Please select a file first');
            return;
        }
        
        const button = document.getElementById('run-client');
        button.disabled = true;
        
        const steps = [
            { id: 'client-load', title: 'Loading video' },
            { id: 'client-extract', title: 'Extracting audio' },
            { id: 'client-upload', title: 'Uploading audio' },
            { id: 'client-process', title: 'Processing' }
        ];
        
        try {
            // Reset timeline and timings
            this.stepTimings = {};
            steps.forEach(step => {
                const el = document.getElementById(step.id);
                el.className = 'timeline-status pending';
                el.textContent = '○';
                // Reset duration display
                const durationEl = document.getElementById(step.id + '-duration');
                if (durationEl) durationEl.textContent = '';
            });
            
            // Step 1: Load video
            this.updateStep('client-load', 'active');
            const startTime = performance.now();
            let stepStart = performance.now();
            
            await this.ffmpeg.writeFile('input.mp4', await fetchFile(this.currentFile));
            this.updateStep('client-load', 'completed', stepStart);
            
            // Step 2: Extract audio
            this.updateStep('client-extract', 'active');
            stepStart = performance.now();
            await this.ffmpeg.exec(['-i', 'input.mp4', '-vn', '-acodec', 'copy', 'output.m4a']);
            
            const data = await this.ffmpeg.readFile('output.m4a');
            const audioBlob = new Blob([data.buffer], { type: 'audio/m4a' });
            
            // Store the audio blob for playback
            this.extractedAudioBlob = audioBlob;
            if (this.extractedAudioUrl) {
                URL.revokeObjectURL(this.extractedAudioUrl);
            }
            this.extractedAudioUrl = URL.createObjectURL(audioBlob);
            
            this.updateStep('client-extract', 'completed', stepStart);
            
            // Step 3: Upload audio
            this.updateStep('client-upload', 'active');
            stepStart = performance.now();
            const formData = new FormData();
            formData.append('audio', audioBlob, 'audio.m4a');
            
            const response = await fetch('http://localhost:3000/upload-audio', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            this.updateStep('client-upload', 'completed', stepStart);
            
            // Step 4: Process
            this.updateStep('client-process', 'active');
            stepStart = performance.now();
            await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate processing
            this.updateStep('client-process', 'completed', stepStart);
            
            const endTime = performance.now();
            const totalTime = (endTime - startTime) / 1000;
            
            this.showResults('client', totalTime, audioBlob.size, audioBlob);
            
        } catch (error) {
            console.error('Client extraction failed:', error);
            alert('Client extraction failed: ' + error.message);
        } finally {
            button.disabled = false;
        }
    }

    async runServerExtraction() {
        if (!this.currentFile) {
            alert('Please select a file first');
            return;
        }
        
        const button = document.getElementById('run-server');
        button.disabled = true;
        
        const steps = [
            { id: 'server-upload', title: 'Uploading video' },
            { id: 'server-extract', title: 'Server extraction' },
            { id: 'server-process', title: 'Processing' }
        ];
        
        try {
            // Reset timeline and timings
            this.stepTimings = {};
            steps.forEach(step => {
                const el = document.getElementById(step.id);
                el.className = 'timeline-status pending';
                el.textContent = '○';
                // Reset duration display
                const durationEl = document.getElementById(step.id + '-duration');
                if (durationEl) durationEl.textContent = '';
            });
            
            const startTime = performance.now();
            let stepStart = performance.now();
            
            // Step 1: Upload video
            this.updateStep('server-upload', 'active');
            const formData = new FormData();
            formData.append('video', this.currentFile);
            
            const response = await fetch('http://localhost:3000/upload-video', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            this.updateStep('server-upload', 'completed', stepStart);
            
            // Step 2: Server extraction
            this.updateStep('server-extract', 'active');
            stepStart = performance.now();
            await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate extraction
            this.updateStep('server-extract', 'completed', stepStart);
            
            // Step 3: Process
            this.updateStep('server-process', 'active');
            stepStart = performance.now();
            await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate processing
            this.updateStep('server-process', 'completed', stepStart);
            
            const endTime = performance.now();
            const totalTime = (endTime - startTime) / 1000;
            
            this.showResults('server', totalTime, this.currentFile.size, null);
            
        } catch (error) {
            console.error('Server extraction failed:', error);
            alert('Server extraction failed: ' + error.message);
        } finally {
            button.disabled = false;
        }
    }

    updateStep(stepId, status, startTime = null) {
        const el = document.getElementById(stepId);
        el.className = `timeline-status ${status}`;
        el.textContent = status === 'completed' ? '✓' : status === 'active' ? '●' : '○';
        
        // Update timing if this step is being completed
        if (status === 'completed' && startTime) {
            const duration = (performance.now() - startTime) / 1000;
            this.stepTimings[stepId] = duration;
            
            // Update duration display
            const durationEl = document.getElementById(stepId + '-duration');
            if (durationEl) {
                durationEl.textContent = `${duration.toFixed(2)}s`;
            }
        }
    }

    showResults(method, time, dataSize, audioBlob = null) {
        const resultsEl = document.getElementById('results');
        resultsEl.style.display = 'block';
        
        const bandwidth = (dataSize * 8) / (time * 1000000); // Mbps
        
        // Create audio player HTML if we have an audio blob
        const audioPlayerHtml = audioBlob && this.extractedAudioUrl ? `
            <div class="audio-player-section">
                <h3>🎵 Extracted Audio Playback</h3>
                <p style="margin-bottom: 15px; color: #666;">Play the extracted audio to verify successful extraction:</p>
                <audio controls class="audio-player">
                    <source src="${this.extractedAudioUrl}" type="audio/m4a">
                    <source src="${this.extractedAudioUrl}" type="audio/mp4">
                    Your browser does not support the audio element.
                </audio>
                <div class="audio-info">
                    <span>Format: M4A (AAC)</span>
                    <span>•</span>
                    <span>Size: ${(audioBlob.size / 1024).toFixed(2)} KB</span>
                    <span>•</span>
                    <span>Compression: ${(this.currentFile.size / audioBlob.size).toFixed(1)}× smaller than video</span>
                </div>
            </div>
        ` : '';
        
        resultsEl.innerHTML = `
            <div class="winner-banner">
                <h2>${method === 'client' ? 'Client-side' : 'Server-side'} Extraction Complete!</h2>
                <p>Total time: ${time.toFixed(2)} seconds</p>
            </div>
            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="metric-card-title">Processing Time</div>
                    <div class="metric-card-value">${time.toFixed(2)}<span class="metric-card-unit">s</span></div>
                </div>
                <div class="metric-card">
                    <div class="metric-card-title">Data Transferred</div>
                    <div class="metric-card-value">${(dataSize / (1024*1024)).toFixed(2)}<span class="metric-card-unit">MB</span></div>
                </div>
                <div class="metric-card">
                    <div class="metric-card-title">Effective Bandwidth</div>
                    <div class="metric-card-value">${bandwidth.toFixed(2)}<span class="metric-card-unit">Mbps</span></div>
                </div>
            </div>
            ${audioPlayerHtml}
        `;
    }

    updateThresholdCalculation() {
        const videoBitrate = parseFloat(document.getElementById('video-bitrate').value) || 8;
        const audioBitrate = parseFloat(document.getElementById('audio-bitrate').value) || 0.128;
        const clientSpeed = parseFloat(document.getElementById('client-speed').value) || 2;
        const serverSpeed = parseFloat(document.getElementById('server-speed').value) || 10;
        
        const threshold = (videoBitrate - audioBitrate) / ((1/clientSpeed) - (1/serverSpeed));
        
        document.getElementById('calculated-threshold').textContent = threshold.toFixed(1);
        
        const recommendation = this.networkSpeed && this.networkSpeed < threshold ? 
            'Use client-side extraction' : 'Use server-side extraction';
        document.getElementById('threshold-recommendation').textContent = recommendation;
    }

    setupUI() {
        document.getElementById('app').innerHTML = `
            <div class="container">
                <div class="header">
                    <h1>Audio Extraction Strategy Demo</h1>
                    <p>Compare client-side vs server-side audio extraction for transcription</p>
                </div>

                <div class="network-info">
                    <h2>Network Information</h2>
                    <div class="network-metrics">
                        <div class="metric">
                            <div class="metric-label">Upload Speed</div>
                            <div class="metric-value"><span id="upload-speed">--</span> Mbps</div>
                        </div>
                        <div class="metric">
                            <div class="metric-label">Network Status</div>
                            <div class="metric-value" id="network-status">Testing...</div>
                        </div>
                        <div class="metric">
                            <div class="metric-label">FFmpeg.wasm</div>
                            <div class="metric-value" id="ffmpeg-status">Loading...</div>
                        </div>
                    </div>
                </div>

                <div class="upload-section">
                    <h2>Select Video File</h2>
                    <div class="file-input-wrapper" id="drop-zone">
                        <div class="upload-icon">📹</div>
                        <div class="upload-text">Drop video file here or click to browse</div>
                        <input type="file" id="file-input" class="file-input" accept="video/*">
                    </div>
                    <div id="file-info" class="file-info" style="display: none;"></div>
                </div>

                <div class="comparison-section">
                    <div class="strategy-card" id="client-strategy">
                        <div class="strategy-header">
                            <div class="strategy-icon">💻</div>
                            <div>
                                <div class="strategy-title">Client-side Extraction</div>
                                <div class="strategy-subtitle">Extract audio in browser, upload audio only</div>
                            </div>
                        </div>
                        
                        <div class="timeline">
                            <div class="timeline-item">
                                <div class="timeline-status pending" id="client-load">○</div>
                                <div class="timeline-content">
                                    <div class="timeline-title">Load video into browser</div>
                                    <div class="timeline-duration" id="client-load-duration"></div>
                                </div>
                            </div>
                            <div class="timeline-item">
                                <div class="timeline-status pending" id="client-extract">○</div>
                                <div class="timeline-content">
                                    <div class="timeline-title">Extract audio with FFmpeg.wasm</div>
                                    <div class="timeline-duration" id="client-extract-duration"></div>
                                </div>
                            </div>
                            <div class="timeline-item">
                                <div class="timeline-status pending" id="client-upload">○</div>
                                <div class="timeline-content">
                                    <div class="timeline-title">Upload audio file</div>
                                    <div class="timeline-duration" id="client-upload-duration"></div>
                                </div>
                            </div>
                            <div class="timeline-item">
                                <div class="timeline-status pending" id="client-process">○</div>
                                <div class="timeline-content">
                                    <div class="timeline-title">Server processing</div>
                                    <div class="timeline-duration" id="client-process-duration"></div>
                                </div>
                            </div>
                        </div>
                        
                        <button class="run-button" id="run-client">Run Client Extraction</button>
                        <div style="margin-top: 15px; text-align: center; color: #666;">
                            Estimated time: <strong id="client-time">--</strong> minutes
                        </div>
                    </div>

                    <div class="strategy-card" id="server-strategy">
                        <div class="strategy-header">
                            <div class="strategy-icon">☁️</div>
                            <div>
                                <div class="strategy-title">Server-side Extraction</div>
                                <div class="strategy-subtitle">Upload full video, extract on server</div>
                            </div>
                        </div>
                        
                        <div class="timeline">
                            <div class="timeline-item">
                                <div class="timeline-status pending" id="server-upload">○</div>
                                <div class="timeline-content">
                                    <div class="timeline-title">Upload full video</div>
                                    <div class="timeline-duration" id="server-upload-duration"></div>
                                </div>
                            </div>
                            <div class="timeline-item">
                                <div class="timeline-status pending" id="server-extract">○</div>
                                <div class="timeline-content">
                                    <div class="timeline-title">Server extracts audio</div>
                                    <div class="timeline-duration" id="server-extract-duration"></div>
                                </div>
                            </div>
                            <div class="timeline-item">
                                <div class="timeline-status pending" id="server-process">○</div>
                                <div class="timeline-content">
                                    <div class="timeline-title">Server processing</div>
                                    <div class="timeline-duration" id="server-process-duration"></div>
                                </div>
                            </div>
                        </div>
                        
                        <button class="run-button" id="run-server">Run Server Extraction</button>
                        <div style="margin-top: 15px; text-align: center; color: #666;">
                            Estimated time: <strong id="server-time">--</strong> minutes
                        </div>
                    </div>
                </div>

                <div class="results-section" id="results" style="display: none;">
                    <!-- Results will be inserted here -->
                </div>

                <div class="decision-visualizer">
                    <h2>Decision Algorithm</h2>
                    <div class="formula-display">
                        <pre>Optimal Strategy Decision:

if (uplink_speed < threshold) {
    use_client_extraction();
} else {
    use_server_extraction();
}

Threshold = (V - A) / ((1/r_c) - (1/r_s))
Where:
  V = video bitrate (Mb/s)
  A = audio bitrate (Mb/s)
  r_c = client extract speed (× realtime)
  r_s = server extract speed (× realtime)</pre>
                    </div>
                    
                    <h3>Calculate Your Threshold</h3>
                    <div class="threshold-calculator">
                        <div class="input-group">
                            <label>Video Bitrate (Mb/s)</label>
                            <input type="number" id="video-bitrate" value="8" step="0.1">
                        </div>
                        <div class="input-group">
                            <label>Audio Bitrate (Mb/s)</label>
                            <input type="number" id="audio-bitrate" value="0.128" step="0.001">
                        </div>
                        <div class="input-group">
                            <label>Client Speed (× realtime)</label>
                            <input type="number" id="client-speed" value="2" step="0.1">
                        </div>
                        <div class="input-group">
                            <label>Server Speed (× realtime)</label>
                            <input type="number" id="server-speed" value="10" step="0.1">
                        </div>
                    </div>
                    
                    <div class="threshold-result">
                        <div>Threshold Upload Speed:</div>
                        <div class="threshold-value"><span id="calculated-threshold">20</span> Mbps</div>
                        <div style="margin-top: 10px; font-size: 1.1rem;">
                            <span id="threshold-recommendation">Use client-side extraction</span>
                        </div>
                    </div>
                    
                    <div style="margin-top: 20px; padding: 20px; background: #f8f9fa; border-radius: 8px;">
                        <h4>Your Current Analysis:</h4>
                        <p>With your network speed of <strong><span id="threshold-speed">--</span> Mbps</strong>,</p>
                        <p id="decision-result" style="font-size: 1.2rem; margin-top: 10px;">
                            Calculating optimal strategy...
                        </p>
                    </div>
                </div>
            </div>
        `;
    }
}

// Initialize the demo
new AudioExtractionDemo();
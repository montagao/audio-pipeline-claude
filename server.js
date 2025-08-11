import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const execAsync = promisify(exec);

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        await fs.mkdir(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit
});

// Enable CORS for the demo
app.use(cors());
app.use(express.json());

// Speed test endpoint
app.post('/speed-test', upload.single('test'), async (req, res) => {
    // Simply acknowledge the upload for speed testing
    if (req.file) {
        await fs.unlink(req.file.path).catch(err => console.log('Cleanup error:', err));
    }
    res.json({ success: true });
});

// Audio upload endpoint (client-side extraction path)
app.post('/upload-audio', upload.single('audio'), async (req, res) => {
    try {
        const startTime = Date.now();
        
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file provided' });
        }

        console.log(`Received audio file: ${req.file.filename}, size: ${req.file.size} bytes`);
        
        // Simulate audio processing (convert to Whisper-friendly format)
        const outputPath = req.file.path.replace(path.extname(req.file.path), '-processed.wav');
        
        try {
            // Convert to 16kHz mono WAV for Whisper
            const command = `ffmpeg -i "${req.file.path}" -vn -ac 1 -ar 16000 -f wav "${outputPath}" -y`;
            await execAsync(command);
            
            const stats = await fs.stat(outputPath);
            console.log(`Processed audio size: ${stats.size} bytes`);
            
            // Clean up
            await fs.unlink(req.file.path);
            await fs.unlink(outputPath).catch(err => console.log('Cleanup error:', err));
            
            const processingTime = Date.now() - startTime;
            
            res.json({
                success: true,
                originalSize: req.file.size,
                processedSize: stats.size,
                processingTime: processingTime,
                compressionRatio: (req.file.size / stats.size).toFixed(2),
                message: 'Audio processed successfully'
            });
            
        } catch (ffmpegError) {
            console.log('FFmpeg not available, simulating processing');
            // If ffmpeg is not available, simulate the processing
            await new Promise(resolve => setTimeout(resolve, 500));
            
            res.json({
                success: true,
                originalSize: req.file.size,
                processedSize: req.file.size * 1.2,
                processingTime: Date.now() - startTime,
                message: 'Audio received successfully (simulated processing)'
            });
            
            // Clean up
            await fs.unlink(req.file.path).catch(err => console.log('Cleanup error:', err));
        }
        
    } catch (error) {
        console.error('Audio processing error:', error);
        res.status(500).json({ error: 'Failed to process audio', details: error.message });
    }
});

// Video upload endpoint (server-side extraction path)
app.post('/upload-video', upload.single('video'), async (req, res) => {
    try {
        const startTime = Date.now();
        
        if (!req.file) {
            return res.status(400).json({ error: 'No video file provided' });
        }

        console.log(`Received video file: ${req.file.filename}, size: ${req.file.size} bytes`);
        
        // Simulate video processing (extract audio and convert)
        const audioPath = req.file.path.replace(path.extname(req.file.path), '-audio.m4a');
        const outputPath = req.file.path.replace(path.extname(req.file.path), '-processed.wav');
        
        try {
            // Extract audio from video
            const extractCommand = `ffmpeg -i "${req.file.path}" -vn -acodec copy "${audioPath}" -y`;
            await execAsync(extractCommand);
            
            // Convert to Whisper-friendly format
            const convertCommand = `ffmpeg -i "${audioPath}" -vn -ac 1 -ar 16000 -f wav "${outputPath}" -y`;
            await execAsync(convertCommand);
            
            const audioStats = await fs.stat(audioPath);
            const processedStats = await fs.stat(outputPath);
            
            console.log(`Extracted audio size: ${audioStats.size} bytes`);
            console.log(`Processed audio size: ${processedStats.size} bytes`);
            
            // Clean up
            await fs.unlink(req.file.path);
            await fs.unlink(audioPath).catch(err => console.log('Cleanup error:', err));
            await fs.unlink(outputPath).catch(err => console.log('Cleanup error:', err));
            
            const processingTime = Date.now() - startTime;
            
            res.json({
                success: true,
                videoSize: req.file.size,
                extractedAudioSize: audioStats.size,
                processedSize: processedStats.size,
                processingTime: processingTime,
                compressionRatio: (req.file.size / audioStats.size).toFixed(2),
                message: 'Video processed and audio extracted successfully'
            });
            
        } catch (ffmpegError) {
            console.log('FFmpeg not available, simulating extraction');
            // If ffmpeg is not available, simulate the extraction
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const estimatedAudioSize = req.file.size * 0.02; // Assume audio is ~2% of video size
            
            res.json({
                success: true,
                videoSize: req.file.size,
                extractedAudioSize: estimatedAudioSize,
                processedSize: estimatedAudioSize * 1.2,
                processingTime: Date.now() - startTime,
                compressionRatio: (req.file.size / estimatedAudioSize).toFixed(2),
                message: 'Video received successfully (simulated extraction)'
            });
            
            // Clean up
            await fs.unlink(req.file.path).catch(err => console.log('Cleanup error:', err));
        }
        
    } catch (error) {
        console.error('Video processing error:', error);
        res.status(500).json({ error: 'Failed to process video', details: error.message });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Endpoints:');
    console.log('  POST /speed-test - Network speed test');
    console.log('  POST /upload-audio - Audio file upload (client extraction)');
    console.log('  POST /upload-video - Video file upload (server extraction)');
    console.log('  GET /health - Health check');
});
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');
const ytDlp = require('yt-dlp-exec');
const validator = require('validator');
const contentDisposition = require('content-disposition');
const mime = require('mime-types');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false
}));
app.use(compression());
app.use(morgan('combined'));
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Origin', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting - different for different endpoints
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: { error: 'Too many requests, please try again later.' }
});

const downloadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // Fewer download attempts
    message: { error: 'Too many download attempts, please try again later.' }
});

app.use('/api/info', generalLimiter);
app.use('/api/download', downloadLimiter);

// Utility functions
function isValidUrl(string) {
    return validator.isURL(string, {
        protocols: ['http', 'https'],
        require_protocol: true,
        require_valid_protocol: true
    });
}

function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return 'Unknown';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
}

function formatFileSize(bytes) {
    if (!bytes || isNaN(bytes)) return 'Unknown';
    
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

function getDefaultThumbnail() {
    return 'https://via.placeholder.com/320x180/667eea/white?text=Video+Thumbnail';
}

function extractFormats(videoInfo) {
    const formats = [];
    
    if (videoInfo.formats && Array.isArray(videoInfo.formats)) {
        videoInfo.formats.forEach(format => {
            // Only include formats with reasonable file sizes
            const fileSize = format.filesize || format.filesize_approx;
            if (fileSize && fileSize > 10000) { // At least 10KB
                const quality = format.format_note || 
                               (format.height ? format.height + 'p' : 'Unknown') ||
                               (format.quality ? format.quality + 'k' : 'Unknown');
                
                formats.push({
                    format_id: format.format_id,
                    ext: format.ext || 'mp4',
                    quality: quality,
                    filesize: formatFileSize(fileSize),
                    vcodec: format.vcodec || 'none',
                    acodec: format.acodec || 'none',
                    has_audio: !!(format.acodec && format.acodec !== 'none'),
                    has_video: !!(format.vcodec && format.vcodec !== 'none')
                });
            }
        });
    }
    
    // Remove duplicates and sort by quality
    const uniqueFormats = formats.filter((format, index, self) =>
        index === self.findIndex(f => f.format_id === format.format_id)
    );
    
    // Sort formats: video first, then audio, by quality
    uniqueFormats.sort((a, b) => {
        // Video formats first
        if (a.has_video && !b.has_video) return -1;
        if (!a.has_video && b.has_video) return 1;
        
        // Extract quality number for sorting
        const getQualityNum = (quality) => {
            const match = quality.match(/(\d+)/);
            return match ? parseInt(match[1]) : 0;
        };
        
        return getQualityNum(b.quality) - getQualityNum(a.quality);
    });
    
    // If no formats found, provide default options
    if (uniqueFormats.length === 0) {
        return [
            {
                format_id: 'best[height<=1080]',
                ext: 'mp4',
                quality: '1080p',
                filesize: 'HD Quality',
                vcodec: 'h264',
                acodec: 'mp3',
                has_audio: true,
                has_video: true
            },
            {
                format_id: 'best[height<=720]',
                ext: 'mp4',
                quality: '720p',
                filesize: 'HD Quality',
                vcodec: 'h264',
                acodec: 'mp3',
                has_audio: true,
                has_video: true
            },
            {
                format_id: 'bestaudio',
                ext: 'mp3',
                quality: 'MP3 Audio',
                filesize: 'Audio Only',
                vcodec: 'none',
                acodec: 'mp3',
                has_audio: true,
                has_video: false
            }
        ];
    }
    
    return uniqueFormats.slice(0, 15); // Limit to 15 formats
}

// Supported platforms
const SUPPORTED_PLATFORMS = [
    'youtube.com', 'youtu.be', 
    'facebook.com', 'fb.watch',
    'instagram.com', 
    'tiktok.com', 'vm.tiktok.com',
    'twitter.com', 'x.com',
    'vimeo.com', 
    'dailymotion.com',
    'linkedin.com',
    'reddit.com',
    'pinterest.com',
    'whatsapp.com',
    'snapchat.com',
    'twitch.tv',
    'bilibili.com',
    'rutube.ru',
    'ok.ru',
    'vk.com'
];

function isPlatformSupported(url) {
    try {
        const domain = new URL(url).hostname.toLowerCase();
        return SUPPORTED_PLATFORMS.some(platform => domain.includes(platform));
    } catch {
        return false;
    }
}

// Health check endpoint
app.get('/api/health', async (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'savemedia-downloader',
        environment: process.env.NODE_ENV || 'development',
        version: '1.0.0',
        dependencies: {
            node: process.version,
            platform: process.platform
        }
    };
    
    // Check if yt-dlp is working
    try {
        await ytDlp('--version');
        health.dependencies.yt_dlp = 'working';
    } catch (error) {
        health.dependencies.yt_dlp = 'error';
        health.status = 'degraded';
    }
    
    res.json(health);
});

// Get video information
app.post('/api/info', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }
        
        console.log('Fetching info for URL:', url);
        
        // Validate URL format
        if (!isValidUrl(url)) {
            return res.status(400).json({ error: 'Invalid URL format' });
        }
        
        // Check if platform is supported
        if (!isPlatformSupported(url)) {
            return res.status(400).json({ 
                error: 'Platform not supported. We support 30+ platforms including YouTube, Facebook, Instagram, TikTok, etc.' 
            });
        }
        
        const videoInfo = await ytDlp(url, {
            dumpJson: true,
            noCheckCertificates: true,
            preferFreeFormats: true,
            youtubeSkipDashManifest: true,
            noWarnings: true,
            timeout: 30000,
            retries: 3
        });
        
        // Format the response
        const formattedInfo = {
            id: videoInfo.id || null,
            title: videoInfo.title || 'Unknown Title',
            duration: formatDuration(videoInfo.duration),
            uploader: videoInfo.uploader || 'Unknown Uploader',
            view_count: videoInfo.view_count || 0,
            thumbnail: videoInfo.thumbnail || getDefaultThumbnail(),
            formats: extractFormats(videoInfo),
            webpage_url: videoInfo.webpage_url || url,
            description: videoInfo.description ? videoInfo.description.substring(0, 200) + '...' : null,
            upload_date: videoInfo.upload_date || null
        };
        
        console.log('Video info fetched successfully:', formattedInfo.title);
        res.json(formattedInfo);
        
    } catch (error) {
        console.error('Error fetching video info:', error);
        
        let errorMessage = 'Failed to fetch video information';
        let statusCode = 500;
        
        if (error.message.includes('Private video') || error.message.includes('Sign in')) {
            errorMessage = 'This video is private or requires login';
            statusCode = 403;
        } else if (error.message.includes('Video unavailable') || error.message.includes('not found')) {
            errorMessage = 'Video not found or unavailable';
            statusCode = 404;
        } else if (error.message.includes('Unsupported URL') || error.message.includes('No video formats')) {
            errorMessage = 'This platform or video is not supported';
            statusCode = 400;
        } else if (error.message.includes('timeout')) {
            errorMessage = 'Request timeout. Please try again.';
            statusCode = 408;
        } else if (error.message.includes('Too Many Requests')) {
            errorMessage = 'Too many requests to the platform. Please try again later.';
            statusCode = 429;
        }
        
        res.status(statusCode).json({ 
            error: errorMessage,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Download video
app.post('/api/download', async (req, res) => {
    let videoStream;
    
    try {
        const { url, format_id, quality } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }
        
        console.log('Download request:', { url, format_id, quality });
        
        // Validate URL format
        if (!isValidUrl(url)) {
            return res.status(400).json({ error: 'Invalid URL format' });
        }
        
        // Check if platform is supported
        if (!isPlatformSupported(url)) {
            return res.status(400).json({ 
                error: 'Platform not supported' 
            });
        }
        
        const options = {
            dumpJson: false,
            noCheckCertificates: true,
            preferFreeFormats: true,
            youtubeSkipDashManifest: true,
            noWarnings: true,
            timeout: 120000, // 2 minutes timeout
            retries: 3
        };
        
        // Get video info first for filename
        const videoInfo = await ytDlp(url, {
            ...options,
            dumpJson: true
        });
        
        // Generate safe filename
        const safeTitle = (videoInfo.title || 'video').replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
        const isAudio = format_id === 'bestaudio' || (quality && quality.toLowerCase().includes('audio'));
        const fileExt = isAudio ? 'mp3' : (videoInfo.ext || 'mp4');
        const filename = `${safeTitle}.${fileExt}`;
        
        // Set headers for download
        res.setHeader('Content-Disposition', contentDisposition(filename));
        res.setHeader('Content-Type', mime.lookup(fileExt) || (isAudio ? 'audio/mpeg' : 'video/mp4'));
        res.setHeader('Cache-Control', 'no-cache, no-store');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        
        // Determine download format
        let downloadFormat = format_id || 'best[height<=720]';
        if (isAudio) {
            downloadFormat = 'bestaudio';
            options.extractAudio = true;
            options.audioFormat = 'mp3';
        }
        
        console.log('Starting download with format:', downloadFormat);
        
        // Stream the download
        videoStream = await ytDlp.exec(url, {
            ...options,
            output: '-',
            format: downloadFormat
        });
        
        // Handle stream events
        videoStream.stdout.pipe(res);
        
        videoStream.stdout.on('error', (error) => {
            console.error('Stream error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Download stream error' });
            }
        });
        
        videoStream.on('close', (code) => {
            console.log(`Download completed with code: ${code}`);
        });
        
        // Handle client disconnect
        req.on('close', () => {
            if (videoStream) {
                videoStream.kill();
                console.log('Download cancelled by client');
            }
        });
        
    } catch (error) {
        console.error('Download error:', error);
        
        if (!res.headersSent) {
            let errorMessage = 'Download failed';
            let statusCode = 500;
            
            if (error.message.includes('Private video') || error.message.includes('Sign in')) {
                errorMessage = 'This video is private or requires login';
                statusCode = 403;
            } else if (error.message.includes('Video unavailable')) {
                errorMessage = 'Video not found or unavailable';
                statusCode = 404;
            } else if (error.message.includes('Unsupported URL')) {
                errorMessage = 'This platform is not supported';
                statusCode = 400;
            } else if (error.message.includes('timeout')) {
                errorMessage = 'Download timeout. Please try again.';
                statusCode = 408;
            }
            
            res.status(statusCode).json({ 
                error: errorMessage,
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
        
        // Clean up stream if it exists
        if (videoStream) {
            videoStream.kill();
        }
    }
});

// Get supported platforms
app.get('/api/platforms', (req, res) => {
    res.json({
        supported_platforms: SUPPORTED_PLATFORMS,
        count: SUPPORTED_PLATFORMS.length,
        message: `Supports ${SUPPORTED_PLATFORMS.length}+ platforms`
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ 
        error: 'Endpoint not found',
        available_endpoints: [
            'GET /api/health',
            'POST /api/info', 
            'POST /api/download',
            'GET /api/platforms'
        ]
    });
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { 
            details: error.message,
            stack: error.stack 
        })
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 savemedia.online backend running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🌐 Health check: http://localhost:${PORT}/api/health`);
    console.log(`🔧 Supported platforms: ${SUPPORTED_PLATFORMS.length}`);
});

module.exports = app;

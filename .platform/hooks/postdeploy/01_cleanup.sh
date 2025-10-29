#!/bin/bash
echo "Running post-deploy cleanup for savemedia.online..."

# Clean up yt-dlp cache
find /tmp -name "yt-dlp-*" -type d -exec rm -rf {} + 2>/dev/null || true
find /tmp -name "*.ytdl" -delete 2>/dev/null || true

# Clean up temporary files
find /tmp/savemedia -type f -mtime +1 -delete 2>/dev/null || true

echo "Cleanup completed successfully!"

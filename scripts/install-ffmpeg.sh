#!/bin/bash
echo "Installing FFmpeg for savemedia.online..."

# Install EPEL repository
sudo yum install -y epel-release

# Install FFmpeg
sudo yum install -y ffmpeg ffmpeg-devel

# Verify installation
ffmpeg -version

echo "FFmpeg installation completed!"

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import yt_dlp
import logging # Naya: Debugging ke liye
from urllib.parse import urlparse, parse_qs, urlunparse, urlencode

# Logging setup for better AWS monitoring
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="SaveMedia Backend (Optimized)",
    version="2.1",
    description="Supports Facebook, Instagram, TikTok with cookies — Direct URL only to save cost."
)

# CORS
allowed_origins = [
    "https://savemedia.online",
    "https://www.savemedia.online",
    "https://ticnotester.blogspot.com",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health Check
@app.get("/")
def home():
    return {"message": "SaveMedia Backend running ✔ (Cost Optimized)"}


# -------------------------------------------------------
# 1️⃣ META endpoint (formats fetch) - ONLY THIS IS NEEDED
# -------------------------------------------------------
@app.get("/download")
def download_info(url: str = Query(..., description="Video URL to fetch information from.")):
    try:
        ydl_opts = {
            "quiet": True,
            "skip_download": True,
            "forcejson": True,
            "cookiefile": "cookies.txt",  # Ensure this file is present on the AWS server!
            "socket_timeout": 30,
            "retries": 5, # Retries 10 se kam kardiye
            # Naya: Only give us the direct URL
            "format": "best", 
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # yt-dlp ki library ko use karna
            info = ydl.extract_info(url, download=False)

        video_title = info.get("title", "video")
        formats = []

        # Pehle aap sirf audio aur video waale formats le rahe the, ab behtar formats dekhte hain
        for f in info.get("formats", []):
            # Check karte hain ki format mein video aur audio dono hon ya sirf direct link ho
            is_valid_format = f.get("url") and f.get("vcodec") != "none"
            
            if is_valid_format:
                # Agar filesize nahi pata, toh None rakhte hain
                filesize = f.get("filesize") or f.get("filesize_approx")
                
                formats.append({
                    "format_id": f.get("format_id"),
                    "ext": f.get("ext"),
                    "resolution": f.get("height"),
                    "filesize": filesize,
                    # Naya: Direct URL de rahe hain. Front-end ko yeh use karna chahiye.
                    "direct_download_url": f.get("url"), 
                    "suggested_filename": f"{video_title}.{f.get('ext')}"
                })

        # Agar koi format na mile toh HTTPException raise karna behtar hai
        if not formats:
             raise Exception("No suitable video formats found for this URL.")

        return {
            "title": video_title,
            "thumbnail": info.get("thumbnail"),
            "formats": formats
        }

    except Exception as e:
        # Error ko log karna
        logger.error(f"Error processing URL {url}: {e}")
        raise HTTPException(
            status_code=400, 
            detail=f"Could not process URL. Check the URL or server logs. Error: {str(e)}"
        )

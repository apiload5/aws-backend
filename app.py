from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import yt_dlp
import requests
from urllib.parse import urlparse, parse_qs, urlunparse, urlencode

app = FastAPI(
    title="SaveMedia Backend",
    version="2.0",
    description="Supports Facebook, Instagram, TikTok with cookies — direct download only."
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
    return {"message": "SaveMedia Backend running ✔"}


# -------------------------------------------------------
# 1️⃣ META endpoint (formats fetch)
# -------------------------------------------------------
@app.get("/download")
def download_info(url: str = Query(...)):
    try:
        ydl_opts = {
            "quiet": True,
            "skip_download": True,
            "forcejson": True,
            "cookiefile": "cookies.txt",  # Facebook / IG / TikTok
            "socket_timeout": 30,
            "retries": 10,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

        video_title = info.get("title", "video")
        formats = []

        for f in info.get("formats", []):
            if f.get("acodec") != "none" and f.get("vcodec") != "none":
                formats.append({
                    "format_id": f.get("format_id"),
                    "ext": f.get("ext"),
                    "resolution": f.get("height"),
                    "filesize": f.get("filesize"),
                    "download_url": f.get("url"),
                    "suggested_filename": f"{video_title}.{f.get('ext')}"
                })

        return {
            "title": video_title,
            "thumbnail": info.get("thumbnail"),
            "formats": formats
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# -------------------------------------------------------
# 2️⃣ STREAM endpoint (forces browser download)
# -------------------------------------------------------
@app.get("/stream")
def stream_video(url: str = Query(...), filename: str = "video.mp4"):

    def iterfile():
        r = requests.get(url, stream=True)
        for chunk in r.iter_content(chunk_size=1024 * 256):
            if chunk:
                yield chunk

    return StreamingResponse(
        iterfile(),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename={filename}"
        }
    )

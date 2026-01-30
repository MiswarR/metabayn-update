import os
import sys
import json
import argparse
import shutil
import subprocess
import numpy as np

# Setup logging to stdout for Tauri to capture
def log_message(text, status="processing", detail=None, file=None):
    msg = {
        "text": text,
        "status": status
    }
    if detail:
        msg["detail"] = detail
    if file:
        msg["file"] = file
    print(json.dumps(msg), flush=True)

def error_exit(message):
    log_message(message, "error")
    sys.exit(1)

# Check dependencies
try:
    import torch
    import clip
    from PIL import Image
    from sklearn.metrics.pairwise import cosine_similarity
except ImportError as e:
    error_exit(f"Missing Python dependency: {e}. Please install torch, clip, pillow, scikit-learn.")

# Constants
IMAGE_EXT = (".jpg",".jpeg",".png",".webp")
VIDEO_EXT = (".mp4",".mkv",".avi",".mov")

def extract_frame(video_path, out_path):
    try:
        subprocess.run([
            "ffmpeg","-y","-i",video_path,
            "-vf","select=eq(n\\,10)",
            "-vframes","1",out_path
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    except Exception as e:
        print(f"DEBUG: FFmpeg error: {e}", file=sys.stderr)

def main():
    parser = argparse.ArgumentParser(description="AI Media Cluster")
    parser.add_argument("--folder", required=True, help="Input folder")
    parser.add_argument("--threshold", type=float, default=0.85, help="Similarity threshold")
    parser.add_argument("--device", default="auto", help="Device (cuda/cpu)")
    args = parser.parse_args()

    folder = args.folder
    threshold = args.threshold
    
    if not os.path.isdir(folder):
        error_exit("Invalid folder path.")

    # Device setup
    if args.device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    else:
        device = args.device
    
    log_message(f"Loading CLIP model on {device}...", "processing")
    
    try:
        model, preprocess = clip.load("ViT-L/14", device=device)
    except Exception as e:
        error_exit(f"Failed to load CLIP model: {e}")

    features = []
    files = []
    temp_frames = []

    # Scan files
    all_files = sorted(os.listdir(folder))
    total_files = len(all_files)
    
    log_message(f"Found {total_files} files. Extracting embeddings...", "processing")
    
    processed_count = 0
    
    for f in all_files:
        path = os.path.join(folder, f)
        ext = os.path.splitext(f)[1].lower()
        
        try:
            img = None
            if ext in IMAGE_EXT:
                img = Image.open(path).convert("RGB")
            elif ext in VIDEO_EXT:
                frame = os.path.join(folder, f"_frame_{f}.jpg")
                extract_frame(path, frame)
                if os.path.exists(frame):
                    img = Image.open(frame).convert("RGB")
                    temp_frames.append(frame)
            
            if img:
                img_input = preprocess(img).unsqueeze(0).to(device)
                with torch.no_grad():
                    feat = model.encode_image(img_input)
                
                features.append(feat.cpu().numpy()[0])
                files.append(f)
                
                log_message(f"Processed: {f}", "processing", file=f)
            
        except Exception as e:
            # print(f"DEBUG: Skip {f}: {e}", file=sys.stderr)
            pass
            
        processed_count += 1

    if not features:
        error_exit("No valid images or videos found to process.")

    X = np.array(features)
    # Normalize
    X = X / np.linalg.norm(X, axis=1, keepdims=True)

    log_message("Clustering media...", "processing")

    # Incremental Clustering
    clusters = []        # list of lists of embeddings
    cluster_files = []   # list of lists of filenames
    
    total_items = len(files)
    
    for i, (emb, fname) in enumerate(zip(X, files)):
        if len(clusters) == 0:
            clusters.append([emb])
            cluster_files.append([fname])
            continue
            
        centroids = [np.mean(c, axis=0) for c in clusters]
        sims = cosine_similarity([emb], centroids)[0]
        best_idx = np.argmax(sims)
        
        if sims[best_idx] >= threshold:
            clusters[best_idx].append(emb)
            cluster_files[best_idx].append(fname)
        else:
            clusters.append([emb])
            cluster_files.append([fname])
            
        if i % 10 == 0:
             log_message(f"Clustering... {i+1}/{total_items}", "processing")

    log_message(f"Formed {len(clusters)} clusters. Moving files...", "processing")

    output_dir = os.path.join(folder, "_ai_media_cluster_output")
    os.makedirs(output_dir, exist_ok=True)

    group_id = 1
    moved_count = 0
    
    for group in cluster_files:
        count = 1
        for fname in group:
            ext = os.path.splitext(fname)[1]
            new_name = f"Group_{group_id:03d} ({count}){ext}"
            
            src = os.path.join(folder, fname)
            dst = os.path.join(output_dir, new_name)
            
            try:
                shutil.move(src, dst)
                moved_count += 1
            except Exception as e:
                print(f"DEBUG: Move error: {e}", file=sys.stderr)
                
            count += 1
        group_id += 1

    # Cleanup temp frames
    for f in temp_frames:
        try:
            if os.path.exists(f):
                os.remove(f)
        except:
            pass

    log_message(f"Done! Processed {moved_count} files into {len(clusters)} groups.", "success")
    log_message(f"Output: {output_dir}", "success")

if __name__ == "__main__":
    main()

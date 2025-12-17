# -*- coding: utf-8 -*-
# src/video_indexer.py - Multi-video support
import os
import cv2
import json
import numpy as np
from PIL import Image
from tqdm import tqdm
from scenedetect import VideoManager, SceneManager
from scenedetect.detectors import ContentDetector
from sentence_transformers import SentenceTransformer
from pathlib import Path

from utils import load_config

def detect_scenes(video_path, threshold=27.0, min_duration=1.0, start_offset=0.2, video_index=0):
    """
    Detect scenes in a video file
    
    Args:
        video_path: Path to video
        threshold: Scene detection threshold
        min_duration: Minimum scene duration
        start_offset: Timing offset compensation
        video_index: Index of this video in the project
    """
    print(f"✂️ Detecting scenes in video {video_index}: {os.path.basename(video_path)}")
    
    video_manager = VideoManager([video_path])
    scene_manager = SceneManager()
    scene_manager.add_detector(ContentDetector(threshold=threshold, min_scene_len=min_duration))
    
    video_manager.start()
    scene_manager.detect_scenes(frame_source=video_manager, show_progress=True)
    scene_list = scene_manager.get_scene_list()
    
    scenes = []
    scene_id = 0
    
    for start, end in scene_list:
        start_time = start.get_seconds() + start_offset
        end_time = end.get_seconds()
        duration = end_time - start_time
        
        if duration < min_duration:
            continue
        
        if start_time >= end_time:
            continue
            
        scenes.append({
            "id": scene_id,
            "video_index": video_index,  # NEW: which video this scene is from
            "start_time": start_time,
            "end_time": end_time,
            "duration": duration,
            "frame_path": ""
        })
        scene_id += 1
    
    print(f"✅ Found {len(scenes)} scenes in video {video_index}")
    return scenes

def extract_frames(video_path, scenes, output_dir, image_size=224, video_index=0):
    """
    Extract keyframes from scenes
    
    Args:
        video_path: Path to video
        scenes: List of scene dicts
        output_dir: Output directory for frames
        image_size: Target image size
        video_index: Video index (for frame naming)
    """
    print(f"📸 Extracting frames from video {video_index}...")
    cap = cv2.VideoCapture(video_path)
    
    if not cap.isOpened():
        raise IOError(f"Cannot open video: {video_path}")

    valid_scenes = []

    for scene in tqdm(scenes, desc=f"Video {video_index}"):
        # Get middle frame
        mid_time = scene["start_time"] + (scene["duration"] / 2)
        scene["key_frame_time"] = mid_time
        
        # Seek to frame
        cap.set(cv2.CAP_PROP_POS_MSEC, mid_time * 1000)
        ret, frame = cap.read()
        
        if ret:
            # Convert BGR -> RGB
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            img = Image.fromarray(frame_rgb)
            img = img.resize((image_size, image_size))
            
            # Naming: video_0_scene_42.jpg
            filename = f"video_{video_index}_scene_{scene['id']}.jpg"
            filepath = os.path.join(output_dir, filename)
            img.save(filepath, quality=80)
            
            scene["frame_path"] = os.path.relpath(filepath)
            valid_scenes.append(scene)
        else:
            print(f"⚠️ Cannot read frame for scene {scene['id']}")

    cap.release()
    return valid_scenes

def embed_scenes(scenes, model_name, device):
    """Generate CLIP embeddings for all scenes"""
    print(f"🧠 Loading CLIP ({model_name}) on {device}...")
    model = SentenceTransformer(model_name, device=device)
    
    image_paths = [s["frame_path"] for s in scenes]
    
    print("⚡ Generating embeddings...")
    
    batch_size = 32
    all_embeddings = []
    
    for i in tqdm(range(0, len(image_paths), batch_size), desc="Encoding batches"):
        batch_paths = image_paths[i:i + batch_size]
        
        # Open images for batch
        images = []
        for path in batch_paths:
            img = Image.open(path)
            images.append(img)
        
        # Encode batch
        batch_embeddings = model.encode(
            images,
            batch_size=batch_size,
            convert_to_tensor=False,
            show_progress_bar=False
        )
        
        all_embeddings.append(batch_embeddings)
        
        # Close images
        for img in images:
            img.close()
    
    # Combine all batches
    embeddings = np.vstack(all_embeddings)
    
    return embeddings

def run_indexer():
    """
    Main indexer - processes ALL videos in project
    """
    cfg = load_config()
    
    # Get project manifest
    from project_manager import ProjectManager
    pm = ProjectManager()
    project_name = cfg.get('current_project')
    
    if not project_name:
        raise ValueError("No active project in config.yaml")
    
    manifest = pm.get_project_manifest(project_name)
    videos = manifest.get('videos', [])
    
    if not videos:
        raise ValueError(f"No videos found in project {project_name}")
    
    print(f"🎬 SculptorPro - Multi-Video Indexer")
    print(f"   Project: {project_name}")
    print(f"   Videos: {len(videos)}")
    print("=" * 60)
    
    cache_dir = cfg["paths"]["cache_dir"]
    frames_dir = cfg["paths"]["frames_dir"]
    index_path = os.path.join(cache_dir, "scene_index.json")
    emb_path = os.path.join(cache_dir, "embeddings.npy")

    # Check if already exists
    if os.path.exists(index_path) and os.path.exists(emb_path):
        print("📂 Index already exists. Skipping indexing.")
        return

    all_scenes = []
    global_scene_id = 0  # Global scene ID across all videos
    
    # Process each video
    for video_info in videos:
        video_index = video_info['index']
        video_filename = video_info['filename']
        video_path = os.path.join(cfg["paths"]["videos_dir"], video_filename)
        
        if not os.path.exists(video_path):
            print(f"⚠️ Video not found: {video_path}")
            continue
        
        print(f"\n📹 Processing video {video_index + 1}/{len(videos)}")
        print(f"   File: {video_filename}")
        
        # 1. Detect scenes
        scenes = detect_scenes(
            video_path,
            threshold=cfg["params"]["scene_threshold"],
            min_duration=cfg["params"]["min_scene_duration"],
            video_index=video_index
        )
        
        # 2. Extract frames
        scenes = extract_frames(
            video_path,
            scenes,
            frames_dir,
            image_size=cfg["params"]["image_size"],
            video_index=video_index
        )
        
        # 3. Assign global scene IDs
        for scene in scenes:
            scene['global_id'] = global_scene_id
            scene['original_id'] = scene['id']  # Keep local ID
            scene['id'] = global_scene_id  # Use global ID
            global_scene_id += 1
        
        all_scenes.extend(scenes)
    
    print(f"\n✅ Total scenes across all videos: {len(all_scenes)}")
    
    # 4. Generate embeddings for ALL scenes
    embeddings = embed_scenes(
        all_scenes,
        cfg["models"]["clip_model"],
        cfg["models"]["device"]
    )
    
    # 5. Save results
    print("💾 Saving index and embeddings...")
    
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(all_scenes, f, indent=4)
        
    np.save(emb_path, embeddings)
    
    print("🎉 Multi-video indexing complete!")
    print(f"   Total videos: {len(videos)}")
    print(f"   Total scenes: {len(all_scenes)}")
    print(f"   Embeddings shape: {embeddings.shape}")

if __name__ == "__main__":
    run_indexer()

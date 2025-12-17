# -*- coding: utf-8 -*-
# src/video_indexer.py
import os
import cv2
import json
import torch
import numpy as np
from PIL import Image
from tqdm import tqdm
from scenedetect import VideoManager, SceneManager
from scenedetect.detectors import ContentDetector
from sentence_transformers import SentenceTransformer

from utils import load_config

def detect_scenes(video_path, threshold=27.0, min_duration=1.0, start_offset=0.2):
    """
    Шаг 1: Нарезка видео на сцены
    
    Args:
        start_offset: Смещение начала сцены в секундах (по умолчанию 0.2)
                     Компенсирует раннее срабатывание детектора
    """
    print(f"✂️ Ищем сцены в {os.path.basename(video_path)}...")
    
    video_manager = VideoManager([video_path])
    scene_manager = SceneManager()
    scene_manager.add_detector(ContentDetector(threshold=threshold, min_scene_len=min_duration))
    
    video_manager.start()
    scene_manager.detect_scenes(frame_source=video_manager, show_progress=True)
    scene_list = scene_manager.get_scene_list()
    
    scenes = []
    scene_id = 0
    
    for start, end in scene_list:
        # КРИТИЧНО: Применяем offset к start_time
        start_time = start.get_seconds() + start_offset
        end_time = end.get_seconds()
        
        # Проверяем, что после offset сцена не стала слишком короткой
        duration = end_time - start_time
        
        if duration < min_duration:
            print(f"⚠️ Пропускаем сцену {scene_id}: слишком короткая после offset ({duration:.2f}s)")
            continue
        
        # Также проверяем, что start не вышел за end
        if start_time >= end_time:
            print(f"⚠️ Пропускаем сцену {scene_id}: start >= end после offset")
            continue
            
        scenes.append({
            "id": scene_id,
            "start_time": start_time,
            "end_time": end_time,
            "duration": duration,
            "frame_path": ""
        })
        scene_id += 1
    
    print(f"✅ Найдено {len(scenes)} сцен (с offset +{start_offset}s).")
    return scenes

def extract_frames(video_path, scenes, output_dir, image_size=224):
    """Шаг 2: Извлечение кадров для каждой сцены"""
    print("📸 Извлекаем кадры...")
    cap = cv2.VideoCapture(video_path)
    
    if not cap.isOpened():
        raise IOError(f"Не удалось открыть видео: {video_path}")

    valid_scenes = []

    for scene in tqdm(scenes):
        # Берем кадр из середины сцены
        mid_time = scene["start_time"] + (scene["duration"] / 2)
        
        # НОВОЕ: Сохраняем время ключевого кадра для точной синхронизации в XML
        scene["key_frame_time"] = mid_time
        
        # Перематываем видео на нужный момент (в миллисекундах)
        cap.set(cv2.CAP_PROP_POS_MSEC, mid_time * 1000)
        ret, frame = cap.read()
        
        if ret:
            # Конвертируем BGR (OpenCV) -> RGB (PIL)
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            img = Image.fromarray(frame_rgb)
            
            # Ресайз для экономии места и скорости
            img = img.resize((image_size, image_size))
            
            filename = f"scene_{scene['id']}.jpg"
            filepath = os.path.join(output_dir, filename)
            relative_path = os.path.relpath(filepath)
            img.save(filepath, quality=80)
            
            scene["frame_path"] = relative_path
            valid_scenes.append(scene)
        else:
            print(f"⚠️ Не удалось прочитать кадр для сцены {scene['id']}")

    cap.release()
    return valid_scenes

def embed_scenes(scenes, model_name, device):
    """Шаг 3: Создание векторов через CLIP"""
    print(f"🧠 Загружаем CLIP ({model_name}) на {device}...")
    model = SentenceTransformer(model_name, device=device)
    
    image_paths = [s["frame_path"] for s in scenes]
    
    print("⚡ Генерируем эмбеддинги (векторы)...")
    
    # ИСПРАВЛЕНО: Открываем изображения батчами, чтобы не держать все файлы открытыми
    batch_size = 32
    all_embeddings = []
    
    for i in tqdm(range(0, len(image_paths), batch_size), desc="Encoding batches"):
        batch_paths = image_paths[i:i + batch_size]
        
        # Открываем изображения для батча
        images = []
        for path in batch_paths:
            img = Image.open(path)
            images.append(img)
        
        # Кодируем батч
        batch_embeddings = model.encode(
            images,
            batch_size=batch_size,
            convert_to_tensor=False,
            show_progress_bar=False
        )
        
        all_embeddings.append(batch_embeddings)
        
        # Закрываем изображения
        for img in images:
            img.close()
    
    # Объединяем все батчи
    embeddings = np.vstack(all_embeddings)
    
    return embeddings

def run_indexer():
    cfg = load_config()
    
    video_path = cfg["paths"]["input_video"]
    
    if not os.path.exists(video_path):
        base, _ = os.path.splitext(video_path)
        mp4_path = base + ".mp4"
        mkv_path = base + ".mkv"

        if os.path.exists(mp4_path):
            video_path = mp4_path
        elif os.path.exists(mkv_path):
            video_path = mkv_path
        else:
            raise FileNotFoundError(f"Не найдено видео ни {mp4_path}, ни {mkv_path}")
        
    cache_dir = cfg["paths"]["cache_dir"]
    frames_dir = cfg["paths"]["frames_dir"]
    index_path = os.path.join(cache_dir, "scene_index.json")
    emb_path = os.path.join(cache_dir, "embeddings.npy")

    # 0. Проверка: Если индекс уже есть, не делаем работу дважды
    if os.path.exists(index_path) and os.path.exists(emb_path):
        print("📂 Индекс уже существует. Пропускаем индексацию.")
        # Тут можно добавить логику "force update", если надо
        return

    # 1. Детекция
    scenes = detect_scenes(
        video_path, 
        threshold=cfg["params"]["scene_threshold"],
        min_duration=cfg["params"]["min_scene_duration"]
    )
    
    # 2. Экстракция кадров
    scenes = extract_frames(
        video_path, 
        scenes, 
        frames_dir, 
        image_size=cfg["params"]["image_size"]
    )
    
    # 3. Эмбеддинг
    embeddings = embed_scenes(
        scenes, 
        cfg["models"]["clip_model"], 
        cfg["models"]["device"]
    )
    
    # 4. Сохранение результатов
    print("💾 Сохраняем данные...")
    
    # Сохраняем JSON (метаданные)
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(scenes, f, indent=4)
        
    # Сохраняем NPY (векторы)
    np.save(emb_path, embeddings)
    
    print("🎉 Индексация завершена!")

if __name__ == "__main__":
    # Для теста запускаем функцию напрямую
    run_indexer()
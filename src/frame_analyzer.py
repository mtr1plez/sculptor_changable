# -*- coding: utf-8 -*-
import os
import json
import base64
from pathlib import Path
from typing import List, Dict
from tqdm import tqdm
import google.generativeai as genai
from dotenv import load_dotenv
from utils import load_config
import time
from google.api_core import exceptions


def encode_image(image_path: str) -> str:
    """
    Кодирует изображение в base64
    
    Args:
        image_path: Путь к изображению
    
    Returns:
        Base64 строка
    """
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode('utf-8')


import time
from google.api_core import exceptions  # Нужно для отлова конкретной ошибки

def analyze_frame_with_gemini(image_path: str, model, scene_id: int, movie_title: str) -> Dict:
    """
    Анализирует один кадр через Gemini API с повторными попытками при ошибке 429
    """
    # Загружаем изображение один раз
    try:
        with open(image_path, 'rb') as f:
            image_data = f.read()
    except Exception as e:
        return {"scene_id": scene_id, "error": f"Image load error: {e}"}

    prompt = f"""You are analyzing a frame from the movie "{movie_title}".
Identify characters by their NAMES if known.
Analyze this frame and extract key visual information in JSON format:
1. "characters": List of characters names or descriptions
2. "objects": Key objects
3. "setting": Location type
4. "mood": Visual mood keywords
5. "colors": Dominant color palette
6. "action": What's happening

Return ONLY valid JSON:
{{
  "characters": [...],
  "objects": [...],
  "setting": "...",
  "mood": [...],
  "colors": [...],
  "action": "..."
}}"""

    # Логика повторных попыток (Retries)
    max_retries = 5
    base_delay = 5  # Начинаем с 5 секунд ожидания

    for attempt in range(max_retries):
        try:
            response = model.generate_content([
                prompt,
                {"mime_type": "image/jpeg", "data": image_data}
            ])
            
            # Парсинг ответа
            response_text = response.text.strip()
            # Очистка от markdown
            if response_text.startswith("```json"): response_text = response_text[7:]
            if response_text.startswith("```"): response_text = response_text[3:]
            if response_text.endswith("```"): response_text = response_text[:-3]
            
            analysis = json.loads(response_text.strip())
            
            # Успех! Добавляем метаданные и возвращаем
            analysis["scene_id"] = scene_id
            analysis["frame_path"] = image_path
            analysis["movie_title"] = movie_title
            return analysis

        except exceptions.ResourceExhausted:
            # Если словили 429 ошибку
            wait_time = base_delay * (2 ** attempt)  # Экспоненциальное увеличение: 5, 10, 20... сек
            print(f"\n⏳ Лимит исчерпан (429) для scene_{scene_id}. Ждем {wait_time} сек... (Попытка {attempt + 1}/{max_retries})")
            time.sleep(wait_time)
            continue  # Идем на следующий круг цикла while/for
            
        except exceptions.InternalServerError:
             # Иногда Google выдает 500 ошибку, тоже полезно подождать
            print(f"\n⚠️ Ошибка сервера Google. Ждем 5 сек...")
            time.sleep(5)
            continue

        except json.JSONDecodeError as e:
            print(f"⚠️ Ошибка парсинга JSON для scene_{scene_id}")
            return {"scene_id": scene_id, "error": "json_parse_error", "raw": response_text[:100]}
            
        except Exception as e:
            print(f"⚠️ Критическая ошибка scene_{scene_id}: {e}")
            return {"scene_id": scene_id, "error": str(e)}

    # Если циклы кончились, а успеха нет
    return {
        "scene_id": scene_id,
        "frame_path": image_path,
        "error": "max_retries_exceeded_429"
    }


def analyze_frames(movie_title=None):
    """Основная функция анализа кадров"""
    cfg = load_config()
    
    # Пути
    frames_dir = Path(cfg['paths']['frames_dir'])
    cache_dir = Path(cfg['paths']['cache_dir'])
    output_file = cache_dir / "frame_analysis.json"
    
    # Проверка наличия кадров
    if not frames_dir.exists():
        print(f"❌ Папка с кадрами не найдена: {frames_dir}")
        print("   Запусти сначала: python src/video_indexer.py")
        return
    
    # Получаем все кадры
    all_frames = sorted(frames_dir.glob("scene_*.jpg"))
    
    if not all_frames:
        print(f"❌ Кадры не найдены в {frames_dir}")
        return
    
    # Берём каждый 10-й кадр
    frames_to_analyze = all_frames[::10]
    
    print(f"🎬 Найдено кадров: {len(all_frames)}")
    print(f"📊 Будем анализировать каждый 10-й: {len(frames_to_analyze)} кадров")
    
    # Спрашиваем название фильма для контекста
    if not movie_title:
        movie_title = cfg.get('current_project', 'Unknown Movie')
    print(f"✅ Фильм: {movie_title}")
    print("="*60 + "\n")
    
    # Загружаем .env файл
    load_dotenv()
    
    # Проверка API ключа
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("\n❌ GEMINI_API_KEY не найден!")
        print("   Добавь его в файл .env в корне проекта:")
        print("   GEMINI_API_KEY=your-api-key-here")
        print("\n   Или установи через переменную окружения:")
        print("   export GEMINI_API_KEY='your-api-key'")
        print("\n   Получить ключ: https://makersuite.google.com/app/apikey")
        return
    
    # Инициализация Gemini
    print(f"🤖 Инициализация Gemini API...")
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel('gemini-2.0-flash')
    
    # Анализ кадров
    print(f"🔍 Начинаем анализ...\n")
    
    analyses = []
    
    for frame_path in tqdm(frames_to_analyze, desc="Analyzing frames"):
        # Извлекаем scene_id из имени файла (scene_42.jpg -> 42)
        scene_id = int(frame_path.stem.split('_')[1])
        
        analysis = analyze_frame_with_gemini(str(frame_path), model, scene_id, movie_title)
        analyses.append(analysis)
    
    # Сохранение результатов
    print(f"\n💾 Сохраняем результаты...")
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(analyses, f, ensure_ascii=False, indent=2)
    
    print(f"✅ Анализ завершён: {output_file}")
    print(f"   Проанализировано кадров: {len(analyses)}")
    
    # Статистика
    successful = sum(1 for a in analyses if "error" not in a)
    failed = len(analyses) - successful
    
    print(f"\n📈 Статистика:")
    print(f"   ✅ Успешно: {successful}")
    if failed > 0:
        print(f"   ⚠️ Ошибок: {failed}")
    
    # Показываем пример
    if analyses and "error" not in analyses[0]:
        print(f"\n📝 Пример анализа (scene {analyses[0]['scene_id']}):")
        example = analyses[0]
        print(f"   Characters: {', '.join(example.get('characters', []))}")
        print(f"   Objects: {', '.join(example.get('objects', []))}")
        print(f"   Setting: {example.get('setting', 'N/A')}")
        print(f"   Mood: {', '.join(example.get('mood', []))}")
        print(f"   Colors: {', '.join(example.get('colors', []))}")
        print(f"   Action: {example.get('action', 'N/A')}")


if __name__ == "__main__":
    analyze_frames()
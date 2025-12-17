# -*- coding: utf-8 -*-
import json
from pathlib import Path
from typing import List, Dict
from utils import load_config


def expand_frame_analysis():
    """
    Расширяет frame_analysis.json, добавляя соседние сцены
    
    Для каждой проанализированной сцены (scene_10) добавляет:
    - scene_9 (предыдущая)
    - scene_11 (следующая)
    
    Копирует все характеристики (персонажи, объекты, настроение),
    так как соседние сцены обычно визуально похожи.
    """
    cfg = load_config()
    
    cache_dir = Path(cfg['paths']['cache_dir'])
    frames_dir = Path(cfg['paths']['frames_dir'])
    
    analysis_file = cache_dir / "frame_analysis.json"
    output_file = cache_dir / "frame_analysis_expanded.json"
    
    print("🎬 SculptorPro - Frame Expander\n")
    print("="*60)
    
    # Проверка наличия анализа
    if not analysis_file.exists():
        print(f"❌ frame_analysis.json не найден: {analysis_file}")
        print("   Запусти сначала: python src/frame_analyzer.py")
        return
    
    # Загрузка
    print("📂 Загружаем анализ кадров...")
    with open(analysis_file, 'r', encoding='utf-8') as f:
        original_analyses = json.load(f)
    
    print(f"   ✅ Исходных анализов: {len(original_analyses)}")
    
    # Получаем все доступные сцены
    all_scene_files = sorted(frames_dir.glob("scene_*.jpg"))
    max_scene_id = max([int(f.stem.split('_')[1]) for f in all_scene_files]) if all_scene_files else 0
    
    print(f"   ✅ Всего сцен в папке: {len(all_scene_files)} (0-{max_scene_id})")
    
    # Расширяем
    expanded_analyses = []
    
    for analysis in original_analyses:
        # Пропускаем сцены с ошибками
        if 'error' in analysis:
            print(f"   ⚠️ Пропускаем scene_{analysis['scene_id']} (содержит ошибку)")
            continue
        
        scene_id = analysis['scene_id']
        
        # Добавляем предыдущую сцену (scene_id - 1)
        prev_id = scene_id - 1
        if prev_id >= 0 and (frames_dir / f"scene_{prev_id}.jpg").exists():
            prev_analysis = analysis.copy()
            prev_analysis['scene_id'] = prev_id
            prev_analysis['frame_path'] = str(frames_dir / f"scene_{prev_id}.jpg")
            prev_analysis['expanded_from'] = scene_id
            prev_analysis['expansion_type'] = 'previous'
            expanded_analyses.append(prev_analysis)
        
        # Добавляем оригинальную сцену
        analysis_copy = analysis.copy()
        analysis_copy['expansion_type'] = 'original'
        expanded_analyses.append(analysis_copy)
        
        # Добавляем следующую сцену (scene_id + 1)
        next_id = scene_id + 1
        if next_id <= max_scene_id and (frames_dir / f"scene_{next_id}.jpg").exists():
            next_analysis = analysis.copy()
            next_analysis['scene_id'] = next_id
            next_analysis['frame_path'] = str(frames_dir / f"scene_{next_id}.jpg")
            next_analysis['expanded_from'] = scene_id
            next_analysis['expansion_type'] = 'next'
            expanded_analyses.append(next_analysis)
    
    # Сортируем по scene_id для удобства
    expanded_analyses.sort(key=lambda x: x['scene_id'])
    
    # Сохраняем
    print(f"\n💾 Сохраняем расширенный анализ...")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(expanded_analyses, f, ensure_ascii=False, indent=2)
    
    print(f"✅ Расширенный анализ сохранён: {output_file}")
    print(f"\n📈 Статистика:")
    print(f"   Было анализов: {len(original_analyses)}")
    print(f"   Стало анализов: {len(expanded_analyses)}")
    print(f"   Прирост: {len(expanded_analyses) / len(original_analyses):.1f}x")
    
    # Статистика по типам
    original_count = sum(1 for a in expanded_analyses if a.get('expansion_type') == 'original')
    prev_count = sum(1 for a in expanded_analyses if a.get('expansion_type') == 'previous')
    next_count = sum(1 for a in expanded_analyses if a.get('expansion_type') == 'next')
    
    print(f"\n   Оригинальных: {original_count}")
    print(f"   Предыдущих: {prev_count}")
    print(f"   Следующих: {next_count}")
    
    # Пример
    if expanded_analyses:
        print(f"\n📝 Пример расширения:")
        
        # Находим первую оригинальную сцену
        for i, analysis in enumerate(expanded_analyses):
            if analysis.get('expansion_type') == 'original':
                scene_id = analysis['scene_id']
                
                print(f"\n   Оригинальная сцена: scene_{scene_id}")
                print(f"      Characters: {', '.join(analysis.get('characters', []))}")
                print(f"      Setting: {analysis.get('setting', 'N/A')}")
                
                # Ищем соседей
                if i > 0:
                    prev = expanded_analyses[i-1]
                    if prev['scene_id'] == scene_id - 1:
                        print(f"\n   Добавлена предыдущая: scene_{prev['scene_id']}")
                        print(f"      (копия характеристик scene_{scene_id})")
                
                if i < len(expanded_analyses) - 1:
                    next_scene = expanded_analyses[i+1]
                    if next_scene['scene_id'] == scene_id + 1:
                        print(f"\n   Добавлена следующая: scene_{next_scene['scene_id']}")
                        print(f"      (копия характеристик scene_{scene_id})")
                
                break
    
    print("\n💡 Теперь можно использовать расширенный анализ в матчере!")
    print("   Обнови smart_matcher.py чтобы читать frame_analysis_expanded.json")


if __name__ == "__main__":
    expand_frame_analysis()
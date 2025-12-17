# -*- coding: utf-8 -*-
"""
Scene Timing Fixer - Автоматическое исправление таймингов сцен

Компенсирует раннее срабатывание детектора сцен, добавляя offset к start_time.
Это устраняет фликеры на стыках сцен.
"""
import os
import json
from pathlib import Path
from typing import Dict

from utils import load_config


class SceneTimingFixer:
    """Автоматический фиксер таймингов сцен"""
    
    # КОНСТАНТА: фиксированный offset для всех проектов
    DEFAULT_OFFSET = 0.2  # секунды
    
    def __init__(self, config_path: str = "config.yaml"):
        self.cfg = load_config(config_path)
    
    def fix_scene_timings(
        self,
        scene_index_path: str = None,
        offset: float = None,
        output_path: str = None,
        backup: bool = True,
        silent: bool = False
    ) -> Dict:
        """
        Автоматическое исправление таймингов сцен
        
        Args:
            scene_index_path: Путь к scene_index.json (None = из config)
            offset: Смещение в секундах (None = использовать DEFAULT_OFFSET)
            output_path: Путь для сохранения (None = перезаписать оригинал)
            backup: Создать резервную копию
            silent: Тихий режим (минимум вывода)
        
        Returns:
            Статистика: {total, fixed, issues, offset}
        """
        # Используем дефолтный offset если не указан
        if offset is None:
            offset = self.DEFAULT_OFFSET
        
        # Дефолтные пути из конфига
        if scene_index_path is None:
            scene_index_path = os.path.join(
                self.cfg["paths"]["cache_dir"],
                "scene_index.json"
            )
        
        if output_path is None:
            output_path = scene_index_path
        
        scene_index_file = Path(scene_index_path)
        
        if not scene_index_file.exists():
            raise FileNotFoundError(f"scene_index.json not found: {scene_index_path}")
        
        # Создаем бэкап (без вывода)
        if backup and output_path == scene_index_path:
            backup_path = scene_index_file.parent / "scene_index_backup.json"
            
            with open(scene_index_file, 'r', encoding='utf-8') as f:
                backup_data = f.read()
            
            with open(backup_path, 'w', encoding='utf-8') as f:
                f.write(backup_data)
        
        # Загружаем сцены
        with open(scene_index_file, 'r', encoding='utf-8') as f:
            scenes = json.load(f)
        
        if not silent:
            print(f"🔧 Fixing scene timings: +{offset}s offset")
            print(f"   Scenes to process: {len(scenes)}")
        
        # Обрабатываем каждую сцену
        fixed_scenes = []
        issues_count = 0
        
        for scene in scenes:
            old_start = scene["start_time"]
            old_end = scene["end_time"]
            
            # Применяем offset
            new_start = old_start + offset
            new_duration = old_end - new_start
            
            # Валидация: пропускаем проблемные сцены
            if new_duration <= 0 or new_start >= old_end:
                issues_count += 1
                continue
            
            # Создаем исправленную сцену
            fixed_scene = scene.copy()
            fixed_scene["start_time"] = round(new_start, 3)
            fixed_scene["duration"] = round(new_duration, 3)
            
            fixed_scenes.append(fixed_scene)
        
        # Сохраняем
        output_file = Path(output_path)
        output_file.parent.mkdir(parents=True, exist_ok=True)
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(fixed_scenes, f, indent=2, ensure_ascii=False)
        
        if not silent:
            print(f"   ✅ Fixed: {len(fixed_scenes)}/{len(scenes)} scenes")
            if issues_count > 0:
                print(f"   ⚠️  Skipped {issues_count} scenes (too short after offset)")
        
        return {
            'total': len(scenes),
            'fixed': len(fixed_scenes),
            'issues': issues_count,
            'offset': offset,
            'output_path': str(output_path)
        }


def fix_timings_for_project(project_name: str = None, offset: float = None) -> Dict:
    """
    Хелпер-функция для быстрого вызова из API
    
    Args:
        project_name: Название проекта (None = текущий из config)
        offset: Смещение (None = 0.2s по умолчанию)
    
    Returns:
        Статистика исправлений
    """
    fixer = SceneTimingFixer()
    
    # Если указан проект, обновляем конфиг
    if project_name:
        from project_manager import ProjectManager
        pm = ProjectManager()
        pm.update_config(project_name)
        # Перезагружаем конфиг
        fixer.cfg = load_config()
    
    return fixer.fix_scene_timings(offset=offset, silent=True)


def main():
    """
    CLI интерфейс - для ручного запуска (не используется в автоматическом режиме)
    """
    fixer = SceneTimingFixer()
    
    print("🎬 Scene Timing Fixer\n")
    
    scene_index_path = os.path.join(
        fixer.cfg["paths"]["cache_dir"],
        "scene_index.json"
    )
    
    if not Path(scene_index_path).exists():
        print(f"❌ scene_index.json not found: {scene_index_path}")
        print("   Run video_indexer.py first")
        return
    
    # Автоматический режим с дефолтным offset
    print(f"Applying default offset: +{SceneTimingFixer.DEFAULT_OFFSET}s\n")
    
    try:
        stats = fixer.fix_scene_timings(silent=False)
        
        print(f"\n✅ Done! Scene timings have been fixed.")
        print(f"   Total scenes: {stats['total']}")
        print(f"   Fixed: {stats['fixed']}")
        
        if stats['issues'] > 0:
            print(f"   Skipped: {stats['issues']} (too short)")
        
        print(f"\n💡 Backup saved as: scene_index_backup.json")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")


if __name__ == "__main__":
    main()
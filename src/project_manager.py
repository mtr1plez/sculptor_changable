# -*- coding: utf-8 -*-
import os
import json
import shutil
from pathlib import Path
from typing import Optional, List, Dict


class ProjectManager:
    """Менеджер проектов для SculptorPro с поддержкой множественных видео"""
    
    def __init__(self, projects_root: str = "data/projects"):
        self.projects_root = Path(projects_root)
        self.config_file = Path("config.yaml")
        self.old_data_dir = Path("data")
    
    def create_project(self, project_name: str) -> Path:
        """
        Создание новой структуры проекта
        
        Args:
            project_name: Имя проекта
        
        Returns:
            Путь к проекту
        """
        project_path = self.projects_root / project_name
        
        if project_path.exists():
            print(f"⚠️ Проект '{project_name}' уже существует")
            return project_path
        
        # Создание структуры папок
        (project_path / "input" / "videos").mkdir(parents=True, exist_ok=True)
        (project_path / "input" / "audio").mkdir(parents=True, exist_ok=True)
        (project_path / "cache" / "frames").mkdir(parents=True, exist_ok=True)
        (project_path / "output").mkdir(parents=True, exist_ok=True)
        
        # Создаём манифест проекта
        manifest = {
            "name": project_name,
            "created_at": str(Path.cwd()),
            "videos": [],
            "audio_file": None
        }
        
        manifest_path = project_path / "project.json"
        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        
        print(f"✅ Создан проект: {project_name}")
        print(f"   📁 {project_path}/")
        print(f"      ├── input/")
        print(f"      │   ├── videos/  (загрузи сюда video1.mp4, video2.mp4...)")
        print(f"      │   └── audio/   (загрузи voice.mp3)")
        print(f"      ├── cache/")
        print(f"      └── output/")
        
        return project_path
    
    def add_video_to_project(self, project_name: str, video_path: str, video_index: int) -> bool:
        """
        Добавить видео в проект
        
        Args:
            project_name: Имя проекта
            video_path: Путь к исходному видео
            video_index: Индекс видео (0, 1, 2...)
        
        Returns:
            True если успешно
        """
        project_path = self.projects_root / project_name
        manifest_path = project_path / "project.json"
        
        if not manifest_path.exists():
            raise FileNotFoundError(f"Проект не найден: {project_name}")
        
        # Копируем видео с индексом
        video_filename = f"video_{video_index:03d}{Path(video_path).suffix}"
        dest_path = project_path / "input" / "videos" / video_filename
        
        shutil.copy(video_path, dest_path)
        
        # Обновляем манифест
        with open(manifest_path, 'r', encoding='utf-8') as f:
            manifest = json.load(f)
        
        manifest['videos'].append({
            "index": video_index,
            "filename": video_filename,
            "original_name": Path(video_path).name
        })
        
        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        
        print(f"✅ Добавлено видео: {video_filename}")
        return True
    
    def add_audio_to_project(self, project_name: str, audio_path: str) -> bool:
        """Добавить аудио в проект"""
        project_path = self.projects_root / project_name
        manifest_path = project_path / "project.json"
        
        if not manifest_path.exists():
            raise FileNotFoundError(f"Проект не найден: {project_name}")
        
        # Копируем аудио
        audio_filename = "voice.mp3"
        dest_path = project_path / "input" / "audio" / audio_filename
        
        shutil.copy(audio_path, dest_path)
        
        # Обновляем манифест
        with open(manifest_path, 'r', encoding='utf-8') as f:
            manifest = json.load(f)
        
        manifest['audio_file'] = audio_filename
        
        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        
        print(f"✅ Добавлено аудио: {audio_filename}")
        return True
    
    def get_project_manifest(self, project_name: str) -> Dict:
        """Получить манифест проекта"""
        project_path = self.projects_root / project_name
        manifest_path = project_path / "project.json"
        
        if not manifest_path.exists():
            # Для старых проектов создаём манифест на лету
            return self._create_legacy_manifest(project_path)
        
        with open(manifest_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def _create_legacy_manifest(self, project_path: Path) -> Dict:
        """Создать манифест для старого проекта (миграция)"""
        videos = []
        old_video = project_path / "input" / "movie.mp4"
        
        if old_video.exists():
            videos.append({
                "index": 0,
                "filename": "movie.mp4",
                "original_name": "movie.mp4"
            })
        
        audio_file = None
        old_audio = project_path / "input" / "voice.mp3"
        if old_audio.exists():
            audio_file = "voice.mp3"
        
        return {
            "name": project_path.name,
            "videos": videos,
            "audio_file": audio_file,
            "legacy": True
        }
    
    def list_projects(self) -> List[str]:
        """Получение списка существующих проектов"""
        if not self.projects_root.exists():
            return []
        
        projects = [
            d.name for d in self.projects_root.iterdir() 
            if d.is_dir()
        ]
        return sorted(projects)
    
    def get_project_info(self, project_name: str) -> dict:
        """
        Получение информации о проекте
        
        Args:
            project_name: Имя проекта
        
        Returns:
            Словарь с информацией о проекте
        """
        project_path = self.projects_root / project_name
        
        if not project_path.exists():
            return {'exists': False}
        
        cache_path = project_path / "cache"
        manifest = self.get_project_manifest(project_name)
        
        info = {
            'exists': True,
            'name': project_name,
            'path': str(project_path),
            'video_count': len(manifest.get('videos', [])),
            'has_audio': manifest.get('audio_file') is not None,
            'has_frames': (cache_path / "frames").exists() and 
                         len(list((cache_path / "frames").glob("*.jpg"))) > 0,
            'has_transcript': (cache_path / "transcript.json").exists(),
            'has_embeddings': (cache_path / "embeddings.npy").exists(),
            'has_characters': (cache_path / "frame_analysis.json").exists(),
            'has_edit_plan': (cache_path / "edit_plan.json").exists(),
        }
        
        return info
    
    def update_config(self, project_name: str):
        """
        Обновление config.yaml с путями проекта
        
        Args:
            project_name: Имя проекта
        """
        import yaml
        
        project_path = self.projects_root / project_name
        manifest = self.get_project_manifest(project_name)
        
        # Читаем существующий конфиг или создаем новый
        if self.config_file.exists():
            with open(self.config_file, 'r', encoding='utf-8') as f:
                config = yaml.safe_load(f) or {}
        else:
            config = {}
        
        # Для обратной совместимости - первое видео как основное
        first_video = manifest['videos'][0]['filename'] if manifest['videos'] else "movie.mp4"
        audio_file = manifest.get('audio_file', 'voice.mp3')
        
        # Обновляем пути
        config['current_project'] = project_name
        config['paths'] = {
            'project_root': str(project_path),
            'input_video': str(project_path / "input" / "videos" / first_video),
            'input_audio': str(project_path / "input" / "audio" / audio_file),
            'output_video': str(project_path / "output" / "final_result.mp4"),
            'cache_dir': str(project_path / "cache"),
            'frames_dir': str(project_path / "cache" / "frames"),
            'videos_dir': str(project_path / "input" / "videos"),  # NEW
        }
        
        # Сохраняем
        with open(self.config_file, 'w', encoding='utf-8') as f:
            yaml.dump(config, f, allow_unicode=True, default_flow_style=False)
        
        print(f"💾 Конфиг обновлен для проекта: {project_name}")


if __name__ == "__main__":
    pm = ProjectManager()
    
    print("🎬 SculptorPro - Project Manager (Multi-Video)\n")
    
    # Выбор проекта
    projects = pm.list_projects()
    if projects:
        print("📂 Доступные проекты:")
        for p in projects:
            info = pm.get_project_info(p)
            print(f"   • {p} ({info['video_count']} видео)")

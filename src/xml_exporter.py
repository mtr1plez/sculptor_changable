# -*- coding: utf-8 -*-
import os
import json
import cv2
from pathlib import Path
from typing import List, Dict
from xml.etree.ElementTree import Element, SubElement, tostring
from xml.dom import minidom
from utils import load_config


def get_video_info(video_path: str) -> Dict:
    """
    Получает информацию о видео
    
    Args:
        video_path: Путь к видео
    
    Returns:
        Словарь с параметрами видео
    """
    cap = cv2.VideoCapture(video_path)
    
    if not cap.isOpened():
        raise IOError(f"Не удалось открыть видео: {video_path}")
    
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps if fps > 0 else 0
    
    cap.release()
    
    return {
        'fps': fps,
        'width': width,
        'height': height,
        'duration': duration,
        'total_frames': total_frames
    }


def load_scene_index(cache_dir: Path) -> List[Dict]:
    """Загружает индекс сцен"""
    index_file = cache_dir / "scene_index.json"
    
    if not index_file.exists():
        raise FileNotFoundError(f"Индекс сцен не найден: {index_file}")
    
    with open(index_file, 'r', encoding='utf-8') as f:
        return json.load(f)


def load_project_manifest(project_root: Path) -> Dict:
    """Загружает манифест проекта для получения списка видео"""
    manifest_file = project_root / "project.json"
    
    if not manifest_file.exists():
        # Legacy project - одно видео
        return {
            "videos": [{
                "index": 0,
                "filename": "movie.mp4",
                "original_name": "movie.mp4"
            }]
        }
    
    with open(manifest_file, 'r', encoding='utf-8') as f:
        return json.load(f)


def create_premiere_xml(edit_plan: List[Dict], scene_index: List[Dict], 
                        video_infos: Dict[int, Dict], video_paths: Dict[int, str],
                        audio_path: str) -> str:
    """
    Создаёт Final Cut Pro 7 XML (совместимый с Premiere Pro)
    
    Args:
        edit_plan: План монтажа
        scene_index: Индекс сцен
        video_infos: {video_index: info} - информация о каждом видео
        video_paths: {video_index: path} - пути к видеофайлам
        audio_path: Путь к аудио озвучки
    
    Returns:
        XML строка
    """
    # Используем параметры первого видео для последовательности
    first_video = video_infos[0]
    fps = int(first_video['fps'])
    width = first_video['width']
    height = first_video['height']
    
    # Создаём карту scene_id -> scene
    scene_map = {scene['id']: scene for scene in scene_index}
    
    # Корневой элемент
    xmeml = Element('xmeml', version="4")
    
    # Проект
    project = SubElement(xmeml, 'project')
    SubElement(project, 'name').text = "SculptorPro"
    
    # Последовательность
    sequence = SubElement(project, 'children')
    seq = SubElement(sequence, 'sequence', id="sequence-1")
    
    SubElement(seq, 'uuid').text = "sculptor-sequence-001"
    SubElement(seq, 'name').text = "SculptorPro_Timeline"
    SubElement(seq, 'duration').text = str(int(edit_plan[-1]['end'] * fps))
    
    # Rate
    rate = SubElement(seq, 'rate')
    SubElement(rate, 'timebase').text = str(fps)
    SubElement(rate, 'ntsc').text = 'FALSE'
    
    # Timecode
    timecode = SubElement(seq, 'timecode')
    SubElement(timecode, 'rate')
    tc_rate = timecode.find('rate')
    SubElement(tc_rate, 'timebase').text = str(fps)
    SubElement(tc_rate, 'ntsc').text = 'FALSE'
    SubElement(timecode, 'string').text = '00:00:00:00'
    SubElement(timecode, 'frame').text = '0'
    SubElement(timecode, 'displayformat').text = 'NDF'
    
    # Media
    media = SubElement(seq, 'media')
    
    # === VIDEO TRACK ===
    video = SubElement(media, 'video')
    video_format = SubElement(video, 'format')
    SubElement(video_format, 'samplecharacteristics')
    sc = video_format.find('samplecharacteristics')
    
    sc_rate = SubElement(sc, 'rate')
    SubElement(sc_rate, 'timebase').text = str(fps)
    SubElement(sc_rate, 'ntsc').text = 'FALSE'
    
    SubElement(sc, 'width').text = str(width)
    SubElement(sc, 'height').text = str(height)
    SubElement(sc, 'pixelaspectratio').text = 'square'
    SubElement(sc, 'fielddominance').text = 'none'
    
    # Video Track
    video_track = SubElement(video, 'track')
    
    # === AUDIO TRACK ===
    audio = SubElement(media, 'audio')
    audio_format = SubElement(audio, 'format')
    SubElement(audio_format, 'samplecharacteristics')
    asc = audio_format.find('samplecharacteristics')
    SubElement(asc, 'depth').text = '16'
    SubElement(asc, 'samplerate').text = '48000'
    
    # Audio Tracks (2 channels)
    audio_track_1 = SubElement(audio, 'track')
    audio_track_2 = SubElement(audio, 'track')
    
    # ====================================================================
    # ВИДЕО КЛИПЫ - с поддержкой множественных видео
    # ====================================================================
    
    for i, item in enumerate(edit_plan):
        scene_id = item.get('scene_id')
        phrase_start = item['start']
        phrase_end = item['end']
        phrase_duration = phrase_end - phrase_start
        
        # Конвертируем в кадры
        timeline_start_frame = int(phrase_start * fps)
        timeline_end_frame = int(phrase_end * fps)
        phrase_frames = timeline_end_frame - timeline_start_frame
        
        if scene_id is None or scene_id not in scene_map:
            print(f"⚠️ Пропускаем фразу {i}: scene_id={scene_id} не найден")
            continue
        
        scene = scene_map[scene_id]
        video_index = scene.get('video_index', 0)  # Индекс видео из сцены
        
        # Проверяем что видео существует
        if video_index not in video_paths:
            print(f"⚠️ Видео {video_index} не найдено для сцены {scene_id}")
            continue
        
        video_path = video_paths[video_index]
        video_info = video_infos[video_index]
        
        # Видео клип
        clip = SubElement(video_track, 'clipitem', id=f"clipitem-{i+1}")
        SubElement(clip, 'masterclipid').text = f"masterclip-video{video_index}-scene{scene_id}"
        SubElement(clip, 'name').text = f"Video{video_index}_Scene{scene_id}"
        
        # Enabled
        SubElement(clip, 'enabled').text = 'TRUE'
        SubElement(clip, 'duration').text = str(phrase_frames)
        
        # Rate
        clip_rate = SubElement(clip, 'rate')
        SubElement(clip_rate, 'timebase').text = str(fps)
        SubElement(clip_rate, 'ntsc').text = 'FALSE'
        
        # Входная/выходная точка в исходнике
        scene_in_frames = int(scene['start_time'] * fps)
        scene_out_frames = scene_in_frames + phrase_frames
        
        # КРИТИЧЕСКИ ВАЖНО: позиция на таймлайне = точное время из транскрипта
        SubElement(clip, 'start').text = str(timeline_start_frame)
        SubElement(clip, 'end').text = str(timeline_end_frame)
        SubElement(clip, 'in').text = str(scene_in_frames)
        SubElement(clip, 'out').text = str(scene_out_frames)
        
        # ====================================================================
        # КРИТИЧЕСКИЙ FIX: Уникальный file reference для каждого видео
        # ====================================================================
        file_elem = SubElement(clip, 'file', id=f"file-video{video_index}-scene{scene_id}")
        SubElement(file_elem, 'name').text = os.path.basename(video_path)
        SubElement(file_elem, 'pathurl').text = f"file://localhost/{os.path.abspath(video_path).replace(chr(92), '/')}"
        
        file_rate = SubElement(file_elem, 'rate')
        SubElement(file_rate, 'timebase').text = str(fps)
        SubElement(file_rate, 'ntsc').text = 'FALSE'
        
        SubElement(file_elem, 'duration').text = str(video_info['total_frames'])
        
        # Media
        file_media = SubElement(file_elem, 'media')
        file_video = SubElement(file_media, 'video')
        SubElement(file_video, 'samplecharacteristics')
        fsc = file_video.find('samplecharacteristics')
        
        fsc_rate = SubElement(fsc, 'rate')
        SubElement(fsc_rate, 'timebase').text = str(fps)
        SubElement(fsc_rate, 'ntsc').text = 'FALSE'
        
        SubElement(fsc, 'width').text = str(video_info['width'])
        SubElement(fsc, 'height').text = str(video_info['height'])
    
    # ====================================================================
    # АУДИО КЛИП (вся озвучка)
    # ====================================================================
    total_audio_frames = int(edit_plan[-1]['end'] * fps)
    
    for track_idx, audio_track in enumerate([audio_track_1, audio_track_2]):
        audio_clip = SubElement(audio_track, 'clipitem', id=f"audio-{track_idx+1}")
        SubElement(audio_clip, 'masterclipid').text = "audio-master-1"
        SubElement(audio_clip, 'name').text = "Voiceover"
        
        SubElement(audio_clip, 'enabled').text = 'TRUE'
        SubElement(audio_clip, 'duration').text = str(total_audio_frames)
        SubElement(audio_clip, 'start').text = '0'
        SubElement(audio_clip, 'end').text = str(total_audio_frames)
        SubElement(audio_clip, 'in').text = '0'
        SubElement(audio_clip, 'out').text = str(total_audio_frames)
        
        # File
        audio_file = SubElement(audio_clip, 'file', id="audio-file-1")
        SubElement(audio_file, 'name').text = os.path.basename(audio_path)
        SubElement(audio_file, 'pathurl').text = f"file://localhost/{os.path.abspath(audio_path).replace(chr(92), '/')}"
        
        audio_rate = SubElement(audio_file, 'rate')
        SubElement(audio_rate, 'timebase').text = str(fps)
        SubElement(audio_rate, 'ntsc').text = 'FALSE'
        
        SubElement(audio_file, 'duration').text = str(total_audio_frames)
        
        # Audio Media
        audio_media = SubElement(audio_file, 'media')
        audio_elem = SubElement(audio_media, 'audio')
        SubElement(audio_elem, 'samplecharacteristics')
        asc_clip = audio_elem.find('samplecharacteristics')
        SubElement(asc_clip, 'depth').text = '16'
        SubElement(asc_clip, 'samplerate').text = '48000'
        
        # Source track
        SubElement(audio_clip, 'sourcetrack')
        st = audio_clip.find('sourcetrack')
        SubElement(st, 'mediatype').text = 'audio'
        SubElement(st, 'trackindex').text = str(track_idx + 1)
    
    # Форматирование XML
    xml_string = tostring(xmeml, encoding='unicode')
    dom = minidom.parseString(xml_string)
    pretty_xml = dom.toprettyxml(indent="  ", encoding=None)
    
    # Убираем лишние пустые строки
    lines = [line for line in pretty_xml.split('\n') if line.strip()]
    return '\n'.join(lines)


def export_to_premiere():
    """Основная функция экспорта"""
    cfg = load_config()
    
    cache_dir = Path(cfg['paths']['cache_dir'])
    project_root = Path(cfg['paths']['project_root'])
    edit_plan_file = cache_dir / "edit_plan.json"
    output_xml = Path(cfg['paths']['output_video']).parent / "premiere_project.xml"
    
    audio_path = cfg['paths']['input_audio']
    
    print("🎬 SculptorPro - XML Exporter (Multi-video)\n")
    print("="*60)
    
    # Проверка файлов
    if not edit_plan_file.exists():
        print(f"❌ План монтажа не найден: {edit_plan_file}")
        print("   Запусти сначала: python src/smart_matcher.py")
        return
    
    if not os.path.exists(audio_path):
        print(f"❌ Аудио озвучки не найдено: {audio_path}")
        return
    
    print("📂 Загружаем данные...")
    
    # Загрузка данных
    with open(edit_plan_file, 'r', encoding='utf-8') as f:
        edit_plan = json.load(f)
    
    scene_index = load_scene_index(cache_dir)
    
    # Загружаем манифест проекта
    manifest = load_project_manifest(project_root)
    
    print(f"   ✅ План монтажа: {len(edit_plan)} фраз")
    print(f"   ✅ Индекс сцен: {len(scene_index)} сцен")
    print(f"   ✅ Видео в проекте: {len(manifest['videos'])}")
    
    # ====================================================================
    # Собираем информацию о всех видео
    # ====================================================================
    videos_dir = project_root / 'input' / 'videos'
    
    video_infos = {}
    video_paths = {}
    
    for video_info in manifest['videos']:
        video_index = video_info['index']
        video_filename = video_info['filename']
        video_path = videos_dir / video_filename
        
        if not video_path.exists():
            print(f"⚠️ Видео не найдено: {video_path}")
            continue
        
        print(f"\n🎥 Анализируем видео {video_index}: {video_filename}")
        info = get_video_info(str(video_path))
        
        print(f"   Разрешение: {info['width']}x{info['height']}")
        print(f"   FPS: {info['fps']:.2f}")
        print(f"   Длительность: {info['duration']:.1f}s")
        
        video_infos[video_index] = info
        video_paths[video_index] = str(video_path)
    
    if not video_infos:
        print("\n❌ Не найдено ни одного видео!")
        return
    
    # Создание XML
    print("\n📝 Генерируем Final Cut Pro 7 XML...")
    
    xml_content = create_premiere_xml(
        edit_plan, 
        scene_index, 
        video_infos,
        video_paths,
        audio_path
    )
    
    # Сохранение
    with open(output_xml, 'w', encoding='utf-8') as f:
        f.write(xml_content)
    
    print(f"\n✅ XML проект создан: {output_xml}")
    print(f"   Клипов на таймлайне: {len(edit_plan)}")
    print(f"   Использовано видео: {len(video_infos)}")
    print(f"   Общая длительность: {edit_plan[-1]['end']:.1f}s")
    
    print("\n📌 Как импортировать в Premiere Pro:")
    print("   1. File → Import...")
    print(f"   2. Выбери файл: {output_xml.name}")
    print("   3. Sequence появится в Project Panel")
    print("   4. Двойной клик - откроется Timeline")
    
    print("\n💡 Альтернативный способ:")
    print("   File → Import → Final Cut Pro XML...")
    
    print("\n⚠️ Важно: Исходные файлы должны быть доступны:")
    for video_index, video_path in video_paths.items():
        print(f"   📹 Video {video_index}: {video_path}")
    print(f"   🎤 {audio_path}")


if __name__ == "__main__":
    export_to_premiere()

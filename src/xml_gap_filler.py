# -*- coding: utf-8 -*-
"""
XML Gap Filler - заполняет пробелы между клипами на таймлайне

Растягивает каждый клип до начала следующего, устраняя черные промежутки.
"""
import xml.etree.ElementTree as ET
from pathlib import Path
from utils import load_config


def fix_timeline_gaps(xml_path: str, output_path: str = None):
    """
    Исправляет пробелы на таймлайне, растягивая клипы
    
    Args:
        xml_path: Путь к XML файлу
        output_path: Путь для сохранения (если None - перезапишет исходный)
    """
    print("🔧 XML Gap Filler\n")
    print("="*60)
    print(f"📂 Загружаем XML: {xml_path}\n")
    
    # Парсим XML
    tree = ET.parse(xml_path)
    root = tree.getroot()
    
    # Находим видео трек
    video_track = root.find('.//video/track')
    
    if video_track is None:
        print("❌ Видео трек не найден в XML")
        return
    
    # Получаем все clipitem элементы
    clips = list(video_track.findall('clipitem'))
    
    print(f"📊 Найдено клипов: {len(clips)}\n")
    
    if len(clips) == 0:
        print("❌ Нет клипов для обработки")
        return
    
    # Обрабатываем каждый клип
    gaps_fixed = 0
    total_frames_added = 0
    
    for i in range(len(clips) - 1):
        current_clip = clips[i]
        next_clip = clips[i + 1]
        
        # Получаем временные метки
        current_end = int(current_clip.find('end').text)
        next_start = int(next_clip.find('start').text)
        
        gap = next_start - current_end
        
        if gap > 0:
            # Есть пробел - растягиваем текущий клип
            old_end = current_end
            new_end = next_start
            
            # Обновляем end
            current_clip.find('end').text = str(new_end)
            
            # Обновляем duration
            current_start = int(current_clip.find('start').text)
            new_duration = new_end - current_start
            current_clip.find('duration').text = str(new_duration)
            
            # Обновляем out (точка выхода из исходника)
            # Растягиваем клип в исходнике на величину пробела
            current_out = int(current_clip.find('out').text)
            new_out = current_out + gap
            current_clip.find('out').text = str(new_out)
            
            gaps_fixed += 1
            total_frames_added += gap
            
            scene_name = current_clip.find('name').text
            print(f"✅ {scene_name}: {old_end} → {new_end} (+{gap} frames)")
    
    # Сохраняем
    if output_path is None:
        output_path = xml_path
    
    tree.write(output_path, encoding='utf-8', xml_declaration=True)
    
    print(f"\n💾 Сохранено: {output_path}")
    print(f"\n📈 Статистика:")
    print(f"   Пробелов исправлено: {gaps_fixed}")
    print(f"   Всего кадров добавлено: {total_frames_added}")
    
    if gaps_fixed > 0:
        avg_gap = total_frames_added / gaps_fixed
        print(f"   Средний размер пробела: {avg_gap:.1f} frames")
    
    # Проверка - остались ли пробелы
    remaining_gaps = 0
    for i in range(len(clips) - 1):
        current_end = int(clips[i].find('end').text)
        next_start = int(clips[i + 1].find('start').text)
        if next_start > current_end:
            remaining_gaps += 1
    
    if remaining_gaps == 0:
        print(f"\n✅ Все пробелы устранены! Таймлайн непрерывный.")
    else:
        print(f"\n⚠️ Осталось пробелов: {remaining_gaps}")


def main():
    """Основная функция"""
    cfg = load_config()
    
    # Путь к XML
    output_dir = Path(cfg['paths']['output_video']).parent
    xml_file = output_dir / "premiere_project.xml"
    
    if not xml_file.exists():
        print(f"❌ XML файл не найден: {xml_file}")
        print("   Запусти сначала: python src/xml_exporter.py")
        return
    
    # Создаём резервную копию
    backup_file = output_dir / "premiere_project_backup.xml"
    
    if not backup_file.exists():
        import shutil
        shutil.copy(xml_file, backup_file)
        print(f"💾 Создана резервная копия: {backup_file}\n")
    
    # Исправляем пробелы
    fix_timeline_gaps(str(xml_file))
    
    print("\n💡 Теперь можно импортировать обновлённый XML в Premiere Pro!")


if __name__ == "__main__":
    main()
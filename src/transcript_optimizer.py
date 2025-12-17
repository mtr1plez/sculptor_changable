# -*- coding: utf-8 -*-
import json
import os
import re
from typing import List, Dict
from utils import load_config


def split_by_punctuation(text: str) -> List[str]:
    """
    Разбивает текст на фразы по знакам препинания
    
    Args:
        text: Исходный текст
    
    Returns:
        Список фраз
    """
    # Ищем все позиции знаков препинания, после которых идёт пробел или конец строки
    # Это гарантирует, что мы не режем дефисы внутри слов (40-year-old)
    split_positions = []
    
    for i, char in enumerate(text):
        # Проверяем, является ли символ знаком препинания
        if char in ',.?!;:—–-':  # добавил разные виды тире
            # Проверяем, что после него пробел или конец строки
            if i + 1 >= len(text) or text[i + 1].isspace():
                # Сохраняем позицию ПОСЛЕ знака препинания
                split_positions.append(i + 1)
    
    # Если не нашли ни одного знака препинания - возвращаем весь текст
    if not split_positions:
        return [text.strip()] if text.strip() else []
    
    # Режем текст по найденным позициям
    phrases = []
    start = 0
    
    for pos in split_positions:
        phrase = text[start:pos].strip()
        if phrase:
            phrases.append(phrase)
        start = pos
    
    # Добавляем остаток текста после последнего знака препинания
    if start < len(text):
        remaining = text[start:].strip()
        if remaining:
            phrases.append(remaining)
    
    return phrases


def optimize_segment(segment: Dict) -> List[Dict]:
    """
    Оптимизирует один сегмент транскрипции
    
    Args:
        segment: Исходный сегмент с start, end, text
    
    Returns:
        Список оптимизированных подсегментов
    """
    text = segment["text"]
    start_time = segment["start"]
    end_time = segment["end"]
    duration = end_time - start_time
    
    # Разбиваем текст на фразы
    phrases = split_by_punctuation(text)
    
    # Если разбить не удалось (нет знаков препинания) - возвращаем как есть
    if len(phrases) <= 1:
        return [segment]
    
    # Распределяем время пропорционально длине фраз
    total_chars = sum(len(p) for p in phrases)
    
    subsegments = []
    current_time = start_time
    
    for phrase in phrases:
        # Время на эту фразу пропорционально её длине
        phrase_duration = (len(phrase) / total_chars) * duration
        phrase_end = current_time + phrase_duration
        
        subsegments.append({
            "start": round(current_time, 3),
            "end": round(phrase_end, 3),
            "text": phrase
        })
        
        current_time = phrase_end
    
    # Корректируем последний подсегмент чтобы точно совпадал с оригинальным концом
    if subsegments:
        subsegments[-1]["end"] = end_time
    
    return subsegments


def optimize_transcript():
    """Основная функция оптимизации транскрипции"""
    cfg = load_config()
    
    cache_dir = cfg['paths']['cache_dir']
    input_file = os.path.join(cache_dir, "transcript.json")
    output_file = os.path.join(cache_dir, "transcript_optimized.json")
    
    # Проверка наличия транскрипции
    if not os.path.exists(input_file):
        print(f"❌ Транскрипция не найдена: {input_file}")
        print("   Запусти сначала: python src/audio_transcriber.py")
        return
    
    print(f"🎯 Оптимизируем транскрипцию: {input_file}")
    
    # Загрузка исходной транскрипции
    with open(input_file, 'r', encoding='utf-8') as f:
        original_segments = json.load(f)
    
    print(f"   Исходных сегментов: {len(original_segments)}")
    
    # Оптимизация каждого сегмента
    optimized_segments = []
    for segment in original_segments:
        subsegments = optimize_segment(segment)
        optimized_segments.extend(subsegments)
    
    print(f"   Оптимизированных сегментов: {len(optimized_segments)}")
    print(f"   Прирост детализации: {len(optimized_segments) / len(original_segments):.1f}x")
    
    # Сохранение
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(optimized_segments, f, ensure_ascii=False, indent=2)
    
    print(f"✅ Оптимизированная транскрипция сохранена: {output_file}")
    
    # Показываем пример
    if optimized_segments:
        print("\n📝 Пример оптимизации:")
        print("   Было:")
        for seg in original_segments[:2]:
            print(f"      [{seg['start']:.1f}s - {seg['end']:.1f}s] {seg['text'][:60]}...")
        
        print("\n   Стало:")
        for seg in optimized_segments[:5]:
            print(f"      [{seg['start']:.1f}s - {seg['end']:.1f}s] {seg['text']}")


if __name__ == "__main__":
    optimize_transcript()
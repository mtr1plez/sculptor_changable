# -*- coding: utf-8 -*-
"""
SculptorPro - Smart Matcher with Narrative Awareness

This module uses Google Gemini as a "Director Agent" to understand
narrative context and maintain visual continuity across edits.

Key Features:
- Entity resolution (Daniel Craig → Mikael Blomkvist)
- Sticky focus logic (maintain character continuity)
- Pre-processing with Gemini for visual intent
- Optimized frame embeddings (calculated once)
- Gemini response caching
"""

import os
import json
import hashlib
import numpy as np
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, asdict
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
from dotenv import load_dotenv
import google.generativeai as genai
from tqdm import tqdm
from utils import load_config
import time  # <--- Добавить
from google.api_core import exceptions  # <--- Добавить обязательно


@dataclass
class VisualIntent:
    """Structured output from Gemini Director Agent"""
    focus_entity: str  # Main character/subject (resolved)
    secondary_entities: List[str]  # Other characters in frame
    visual_action: str  # What we want to see (e.g., "close-up", "wide shot")
    mood: str  # Emotional tone (e.g., "tense", "calm")
    setting: str  # Location preference (e.g., "office", "street")
    objects: List[str]  # Key props that should be visible
    context_window_id: int  # For debugging


class GeminiCache:
    """Simple disk-based cache for Gemini responses"""
    
    def __init__(self, cache_dir: Path):
        self.cache_dir = cache_dir / "gemini_cache"
        self.cache_dir.mkdir(exist_ok=True)
    
    def _get_key(self, prompt: str) -> str:
        """Generate cache key from prompt"""
        return hashlib.md5(prompt.encode()).hexdigest()
    
    def get(self, prompt: str) -> Optional[str]:
        """Retrieve cached response"""
        key = self._get_key(prompt)
        cache_file = self.cache_dir / f"{key}.json"
        
        if cache_file.exists():
            with open(cache_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data.get('response')
        return None
    
    def set(self, prompt: str, response: str):
        """Cache a response"""
        key = self._get_key(prompt)
        cache_file = self.cache_dir / f"{key}.json"
        
        with open(cache_file, 'w', encoding='utf-8') as f:
            json.dump({'prompt': prompt, 'response': response}, f, ensure_ascii=False)


class NarrativeContextAnalyzer:
    """
    Uses Gemini to analyze narrative context and resolve entities.
    
    This is the "Director Agent" - it understands the story and provides
    explicit visual instructions for each phrase.
    """
    
    def __init__(self, gemini_model, cache: GeminiCache, frame_analyses: List[Dict]):
        self.model = gemini_model
        self.cache = cache
        self.frame_analyses = frame_analyses
        
        # Extract all known character names from frame analyses
        self.known_characters = self._extract_known_characters()
        
        # Sticky focus: tracks which entity we're currently following
        self.current_focus = None
        self.focus_lock_strength = 0  # How strongly to maintain focus (0-3)
    
    def _extract_known_characters(self) -> List[str]:
        """Extract unique character names from frame analyses"""
        characters = set()
        for frame in self.frame_analyses:
            if 'characters' in frame and 'error' not in frame:
                for char in frame['characters']:
                    # Split multi-word names
                    parts = char.split()
                    characters.update([p for p in parts if len(p) > 2])
        return sorted(list(characters))
    
    def analyze_window(self, phrases: List[Dict], window_start_idx: int, 
                      context_size: int = 5) -> List[VisualIntent]:
        """
        Analyze a window of phrases to get visual intent with narrative context.
        
        Args:
            phrases: All phrases from transcript
            window_start_idx: Start index of current window
            context_size: Number of phrases to include in context
        
        Returns:
            List of VisualIntent objects for each phrase in window
        """
        # Get context window
        window_end_idx = min(window_start_idx + context_size, len(phrases))
        context_phrases = phrases[window_start_idx:window_end_idx]

        # Get previous context for continuity (last 2 phrases)
        prev_start = max(0, window_start_idx - 2)
        prev_phrases = phrases[prev_start:window_start_idx]

        # Build prompt for Gemini
        prompt = self._build_director_prompt(prev_phrases, context_phrases)

        # Check cache first
        cached = self.cache.get(prompt)
        if cached:
            # print(f"  ⚡ Cache hit for window {window_start_idx}") # Можно раскомментить для отладки
            return self._parse_gemini_response(cached, window_start_idx)

        # Retry logic parameters
        max_retries = 5
        base_delay = 2

        # Call Gemini with Retries
        for attempt in range(max_retries):
            try:
                response = self.model.generate_content(prompt)
                response_text = response.text.strip()

                # Clean markdown
                if response_text.startswith("```json"):
                    response_text = response_text[7:]
                if response_text.startswith("```"):
                    response_text = response_text[3:]
                if response_text.endswith("```"):
                    response_text = response_text[:-3]
                response_text = response_text.strip()

                # Cache it
                self.cache.set(prompt, response_text)

                # Success - return parsed
                return self._parse_gemini_response(response_text, window_start_idx)

            except exceptions.ResourceExhausted:
                wait_time = base_delay * (5 ** attempt)  # 2, 4, 8, 16, 32 sec
                print(f"\n  ⏳ Лимит (429) на окне {window_start_idx}. Ждем {wait_time} сек...")
                time.sleep(wait_time)
            
            except exceptions.InternalServerError:
                print(f"\n  ⚠️ Ошибка сервера (500). Ждем 5 сек...")
                time.sleep(5)
                
            except Exception as e:
                print(f"  ⚠️ Ошибка Gemini (попытка {attempt+1}): {e}")
                if attempt < max_retries - 1:
                    time.sleep(2)
                else:
                    print(f"  ❌ Не удалось получить ответ для окна {window_start_idx}")

        # Fallback: create basic intents only if all retries failed
        print(f"  ⤵️ Использование Fallback для окна {window_start_idx}")
        return self._create_fallback_intents(context_phrases, window_start_idx)
    
    def _build_director_prompt(self, prev_phrases: List[Dict], 
                               current_phrases: List[Dict]) -> str:
        """Build detailed prompt for Gemini Director Agent"""
        
        prompt = f"""You are a Film Director Agent analyzing a video essay script.

KNOWN CHARACTERS IN THE MOVIE:
{', '.join(self.known_characters[:20])}

YOUR TASK: Analyze each phrase and provide EXPLICIT visual instructions.

CRITICAL: Entity Resolution
- If the script says "Daniel Craig", "Craig", or "the actor" in context of discussing a CHARACTER,
  your output MUST resolve this to the CHARACTER NAME (e.g., "Mikael Blomkvist"), NOT the actor.
- Focus on WHO should be ON SCREEN, not who is being discussed abstractly.

"""
        
        # Add previous context for continuity
        if prev_phrases:
            prompt += "PREVIOUS CONTEXT (for continuity):\n"
            for i, phrase in enumerate(prev_phrases):
                prompt += f"  {i+1}. \"{phrase['text']}\"\n"
            prompt += "\n"
        
        if self.current_focus:
            prompt += f"CURRENT VISUAL FOCUS: {self.current_focus} (maintain unless explicitly changed)\n\n"
        
        prompt += "PHRASES TO ANALYZE:\n"
        for i, phrase in enumerate(current_phrases, 1):
            prompt += f"{i}. \"{phrase['text']}\"\n"
        
        prompt += """

For EACH phrase, return a JSON object with:
{
  "focus_entity": "Primary character/subject to show (RESOLVED name, e.g., 'Mikael Blomkvist')",
  "secondary_entities": ["Other characters visible", "..."],
  "visual_action": "Shot type/action (e.g., 'close-up', 'walking', 'conversation')",
  "mood": "Emotional tone (e.g., 'tense', 'calm', 'mysterious')",
  "setting": "Location (e.g., 'office', 'apartment', 'street')",
  "objects": ["Key props", "laptop", "..."]
}

RULES:
1. If a phrase uses pronouns (he/she/they), resolve to the last mentioned character name.
2. If discussing an actor playing a role, focus_entity = CHARACTER NAME, not actor.
3. If establishing a new subject, set focus_entity explicitly.
4. If continuing previous focus (pronouns, contextual), use the same focus_entity.
5. secondary_entities = additional people in shot (if any).

Return as JSON array: [object1, object2, ...]
NO markdown, NO explanations, ONLY valid JSON array.
"""
        
        return prompt
    
    def _parse_gemini_response(self, response_text: str, 
                               window_start_idx: int) -> List[VisualIntent]:
        """Parse Gemini response into VisualIntent objects"""
        try:
            intents_data = json.loads(response_text)
            
            if not isinstance(intents_data, list):
                intents_data = [intents_data]
            
            intents = []
            for i, intent_dict in enumerate(intents_data):
                # Update sticky focus
                focus = intent_dict.get('focus_entity', self.current_focus or 'Unknown')
                
                if focus != self.current_focus:
                    # Focus changed
                    self.current_focus = focus
                    self.focus_lock_strength = 2  # Strong lock on new focus
                elif self.focus_lock_strength > 0:
                    # Maintaining focus
                    self.focus_lock_strength = min(3, self.focus_lock_strength + 1)
                
                intent = VisualIntent(
                    focus_entity=focus or 'Unknown',
                    secondary_entities=intent_dict.get('secondary_entities', []) or [],
                    visual_action=intent_dict.get('visual_action', 'medium shot') or 'medium shot',
                    mood=intent_dict.get('mood', 'neutral') or 'neutral',
                    setting=intent_dict.get('setting', 'any') or 'any',
                    objects=intent_dict.get('objects', []) or [],
                    context_window_id=window_start_idx + i
                )
                intents.append(intent)
            
            return intents
            
        except json.JSONDecodeError as e:
            print(f"⚠️ JSON parse error: {e}")
            print(f"Response: {response_text[:200]}...")
            return []
    
    def _create_fallback_intents(self, phrases: List[Dict], 
                                 window_start_idx: int) -> List[VisualIntent]:
        """Create basic intents when Gemini fails"""
        intents = []
        for i, phrase in enumerate(phrases):
            intent = VisualIntent(
                focus_entity=self.current_focus or 'Unknown',
                secondary_entities=[],
                visual_action='medium shot',
                mood='neutral',
                setting='any',
                objects=[],
                context_window_id=window_start_idx + i
            )
            intents.append(intent)
        return intents


class SmartFrameMatcher:
    """
    Matches phrases to frames using narrative context and semantic similarity.
    
    Pipeline:
    1. Pre-process transcript with Gemini (get VisualIntents)
    2. CLIP search across ALL scenes (fast, visual similarity)
    3. Filter top-K by Gemini analysis (entities, mood) if available
    4. Apply usage limits and diversity rules
    """
    
    def __init__(self, config: Dict, embedding_model: SentenceTransformer,
                 frame_analyses: List[Dict], scene_index: List[Dict],
                 clip_embeddings: Optional[np.ndarray] = None,
                 clip_model: Optional[SentenceTransformer] = None):
        self.config = config
        self.embedding_model = embedding_model  # For text-only semantic search
        self.clip_model = clip_model  # For CLIP text-image search
        self.frame_analyses = frame_analyses
        self.scene_index = scene_index
        self.clip_embeddings = clip_embeddings  # Visual embeddings for ALL scenes
        
        # Create mapping: scene_id -> frame_analysis (for Gemini-analyzed frames)
        self.gemini_analysis_map = {}
        for frame in frame_analyses:
            if 'error' not in frame:
                self.gemini_analysis_map[frame['scene_id']] = frame
        
        print(f"   📊 Gemini analyzed: {len(self.gemini_analysis_map)} scenes")
        print(f"   🎬 CLIP embeddings: {len(clip_embeddings) if clip_embeddings is not None else 0} scenes")
        
        # Pre-calculate text embeddings for Gemini-analyzed frames
        print("🧠 Pre-calculating text embeddings for analyzed frames...")
        self.frame_text_embeddings = self._calculate_text_embeddings()
        
        # Usage tracking
        self.scene_usage = {}  # {scene_id: count}
        self.scene_last_used = {}  # {scene_id: phrase_index}
        self.last_scene_id = None
        self.current_phrase_index = 0  # Track position in timeline
        self.MAX_USAGE = 3
        self.COOLDOWN_PERIOD = 20  # Minimum phrases between repeats
    
    def _calculate_text_embeddings(self) -> Dict[int, np.ndarray]:
        """Calculate text embeddings only for Gemini-analyzed frames"""
        embeddings_map = {}
        
        for scene_id, frame in self.gemini_analysis_map.items():
            # Combine all frame info into searchable text
            parts = []
            if 'characters' in frame:
                parts.append(f"Characters: {', '.join(frame['characters'])}")
            if 'objects' in frame:
                parts.append(f"Objects: {', '.join(frame['objects'])}")
            if 'setting' in frame:
                parts.append(f"Setting: {frame['setting']}")
            if 'mood' in frame:
                parts.append(f"Mood: {', '.join(frame['mood'])}")
            if 'action' in frame:
                parts.append(f"Action: {frame['action']}")
            
            text = ' | '.join(parts) if parts else "empty frame"
            embedding = self.embedding_model.encode([text], convert_to_tensor=False)[0]
            embeddings_map[scene_id] = embedding
        
        return embeddings_map
    
    def match_phrase(self, phrase: Dict, visual_intent: VisualIntent, 
                    phrase_index: int) -> Optional[int]:
        """
        Match a single phrase to the best frame using hybrid search.
        
        Strategy:
        1. If CLIP embeddings available → search ALL scenes visually
        2. If entity specified → hard filter by Gemini analysis
        3. Combine visual + semantic + entity matching
        4. Apply cooldown period to avoid repetition
        
        Args:
            phrase: Phrase from transcript
            visual_intent: Director's instructions
            phrase_index: Current position in timeline (for cooldown tracking)
        
        Returns:
            scene_id of best matching frame
        """
        self.current_phrase_index = phrase_index
        
        # Strategy A: Entity-first (when we have strong narrative focus)
        if visual_intent.focus_entity not in ['Unknown', 'none', ''] and self.gemini_analysis_map:
            candidate_scene_ids = self._filter_by_entity(visual_intent)
            
            if candidate_scene_ids:
                # Found entity matches - use semantic refinement
                best_scene_id = self._semantic_match_scenes(
                    phrase, visual_intent, candidate_scene_ids
                )
                
                # Apply usage constraints
                if self._is_valid_choice(best_scene_id):
                    self._update_usage(best_scene_id)
                    return best_scene_id
        
        # Strategy B: CLIP-first (visual similarity across ALL scenes)
        if self.clip_embeddings is not None:
            # Get top-K visually similar scenes
            top_scene_ids = self._clip_search(phrase, visual_intent, top_k=50)  # Increased to 50 for better filtering
            
            # Refine with Gemini analysis if available
            refined_ids = self._refine_with_gemini(top_scene_ids, visual_intent)
            
            if refined_ids:
                top_scene_ids = refined_ids
            
            # Apply constraints and pick best
            for scene_id in top_scene_ids:
                if self._is_valid_choice(scene_id):
                    self._update_usage(scene_id)
                    return scene_id
        
        # Strategy C: Fallback - semantic search on Gemini-analyzed frames
        if self.gemini_analysis_map:
            candidate_scene_ids = list(self.gemini_analysis_map.keys())
            best_scene_id = self._semantic_match_scenes(
                phrase, visual_intent, candidate_scene_ids
            )
            
            if self._is_valid_choice(best_scene_id):
                self._update_usage(best_scene_id)
                return best_scene_id
        
        print(f"   ⚠️ No valid match found at phrase {phrase_index}")
        return None
    
    def _clip_search(self, phrase: Dict, intent: VisualIntent, top_k: int = 30) -> List[int]:
        """Search ALL scenes using CLIP visual embeddings"""
        if self.clip_embeddings is None or self.clip_model is None:
            return []
        
        # Build text query from phrase + intent
        query_parts = [
            phrase['text'],
            intent.visual_action,
            intent.mood,
            intent.setting
        ]
        if intent.objects:
            query_parts.extend(intent.objects)
        
        query_text = ' '.join(query_parts)
        
        # Encode query using CLIP model (same as video_indexer.py)
        # This ensures dimensional compatibility (512D)
        query_embedding = self.clip_model.encode([query_text], convert_to_tensor=False)[0]
        
        # Calculate similarity to ALL scene embeddings
        similarities = cosine_similarity([query_embedding], self.clip_embeddings)[0]
        
        # Get top-K indices
        top_indices = np.argsort(similarities)[::-1][:top_k]
        
        # Map indices to scene_ids
        scene_ids = [self.scene_index[idx]['id'] for idx in top_indices]
        
        return scene_ids
    
    def _refine_with_gemini(self, scene_ids: List[int], intent: VisualIntent) -> List[int]:
        """Refine CLIP results using Gemini analysis (if available)"""
        refined = []
        
        for scene_id in scene_ids:
            # Check if we have Gemini analysis for this scene
            if scene_id not in self.gemini_analysis_map:
                # No analysis - keep it (don't filter out)
                refined.append(scene_id)
                continue
            
            frame = self.gemini_analysis_map[scene_id]
            
            # Score based on Gemini analysis
            score = 0
            
            # Entity match (highest priority)
            if intent.focus_entity not in ['Unknown', 'none', '']:
                frame_chars = ' '.join(frame.get('characters', [])).lower()
                focus_parts = intent.focus_entity.lower().split()
                if any(part in frame_chars for part in focus_parts if len(part) > 2):
                    score += 10  # Strong bonus for entity match
            
            # Setting match
            if intent.setting != 'any' and 'setting' in frame:
                if intent.setting.lower() in frame['setting'].lower():
                    score += 3
            
            # Mood match
            if 'mood' in frame:
                if intent.mood.lower() in [m.lower() for m in frame['mood']]:
                    score += 2
            
            # Objects match
            if intent.objects and 'objects' in frame:
                frame_objs = [o.lower() for o in frame['objects']]
                matches = sum(1 for obj in intent.objects if obj.lower() in frame_objs)
                score += matches
            
            # Keep if score > 0 or no analysis to compare against
            if score > 0:
                refined.append((scene_id, score))
        
        # Sort by score if we have scored items
        scored = [item for item in refined if isinstance(item, tuple)]
        unscored = [item for item in refined if not isinstance(item, tuple)]
        
        if scored:
            scored.sort(key=lambda x: x[1], reverse=True)
            return [sid for sid, _ in scored] + unscored
        
        return refined
    
    def _filter_by_entity(self, intent: VisualIntent) -> List[int]:
        """Hard filter: scenes with the focus entity (from Gemini analysis)"""
        focus = intent.focus_entity
        
        # Safety checks
        if not focus or focus in ['unknown', 'none', '', 'Unknown', 'None']:
            return []
        
        focus = focus.lower()
        matching_scene_ids = []
        
        for scene_id, frame in self.gemini_analysis_map.items():
            frame_chars = ' '.join(frame.get('characters', [])).lower()
            focus_parts = focus.split()
            
            if any(part in frame_chars for part in focus_parts if len(part) > 2):
                matching_scene_ids.append(scene_id)
        
        return matching_scene_ids
    
    def _semantic_match_scenes(self, phrase: Dict, intent: VisualIntent,
                               scene_ids: List[int]) -> Optional[int]:
        """Semantic matching using text embeddings (for Gemini-analyzed scenes)"""
        if not scene_ids:
            return None
        
        # Filter to only scenes we have text embeddings for
        valid_ids = [sid for sid in scene_ids if sid in self.frame_text_embeddings]
        
        if not valid_ids:
            # Fallback: just return first scene_id
            return scene_ids[0]
        
        # Build query
        query_text = f"{phrase['text']} {intent.visual_action} {intent.mood} {intent.setting}"
        query_embedding = self.embedding_model.encode([query_text], convert_to_tensor=False)[0]
        
        # Get embeddings for candidates
        candidate_embeddings = np.array([
            self.frame_text_embeddings[sid] for sid in valid_ids
        ])
        
        # Calculate similarity
        similarities = cosine_similarity([query_embedding], candidate_embeddings)[0]
        
        # Get best
        best_idx = np.argmax(similarities)
        return valid_ids[best_idx]
    
    def _is_valid_choice(self, scene_id: Optional[int]) -> bool:
        """Check if scene_id passes usage constraints"""
        if scene_id is None:
            return False
        
        # Rule 1: No consecutive repeats
        if scene_id == self.last_scene_id:
            return False
        
        # Rule 2: Cooldown period - minimum phrases between repeats
        if scene_id in self.scene_last_used:
            phrases_since_use = self.current_phrase_index - self.scene_last_used[scene_id]
            if phrases_since_use < self.COOLDOWN_PERIOD:
                return False
        
        # Rule 3: Max usage across entire video
        if self.scene_usage.get(scene_id, 0) >= self.MAX_USAGE:
            return False
        
        return True
    
    def _update_usage(self, scene_id: int):
        """Update usage tracking"""
        self.scene_usage[scene_id] = self.scene_usage.get(scene_id, 0) + 1
        self.scene_last_used[scene_id] = self.current_phrase_index
        self.last_scene_id = scene_id


def load_data(cfg: Dict) -> Tuple[List[Dict], List[Dict], List[Dict], Optional[np.ndarray]]:
    """Load all required data files"""
    cache_dir = Path(cfg['paths']['cache_dir'])
    
    # Transcript
    transcript_file = cache_dir / "transcript_optimized.json"
    if not transcript_file.exists():
        raise FileNotFoundError(f"Transcript not found: {transcript_file}")
    
    with open(transcript_file, 'r', encoding='utf-8') as f:
        phrases = json.load(f)
    
    # Frame analyses (try expanded first)
    expanded_file = cache_dir / "frame_analysis_expanded.json"
    analysis_file = cache_dir / "frame_analysis.json"
    
    if expanded_file.exists():
        print("   📊 Using expanded frame analysis")
        with open(expanded_file, 'r', encoding='utf-8') as f:
            frame_analyses = json.load(f)
    elif analysis_file.exists():
        print("   📊 Using base frame analysis")
        with open(analysis_file, 'r', encoding='utf-8') as f:
            frame_analyses = json.load(f)
    else:
        raise FileNotFoundError("No frame analysis found")
    
    # Scene index
    index_file = cache_dir / "scene_index.json"
    if not index_file.exists():
        raise FileNotFoundError(f"Scene index not found: {index_file}")
    
    with open(index_file, 'r', encoding='utf-8') as f:
        scene_index = json.load(f)
    
    # CLIP embeddings (for ALL scenes)
    embeddings_file = cache_dir / "embeddings.npy"
    clip_embeddings = None
    
    if embeddings_file.exists():
        print("   🎨 Loading CLIP embeddings for ALL scenes...")
        clip_embeddings = np.load(embeddings_file)
        print(f"   ✅ CLIP embeddings loaded: {clip_embeddings.shape}")
    else:
        print("   ⚠️ CLIP embeddings not found - will use Gemini-only matching")
    
    return phrases, frame_analyses, scene_index, clip_embeddings


def create_edit_plan():
    """Main function: Create edit plan with narrative awareness"""
    cfg = load_config()
    cache_dir = Path(cfg['paths']['cache_dir'])
    output_file = cache_dir / "edit_plan.json"
    
    print("🎬 SculptorPro - Smart Matcher v2.0 (Narrative Aware)\n")
    print("="*60)
    
    # Load data
    print("📂 Loading data...")
    phrases, frame_analyses, scene_index, clip_embeddings = load_data(cfg)
    
    print(f"   ✅ Phrases: {len(phrases)}")
    print(f"   ✅ Frame analyses: {len(frame_analyses)}")
    print(f"   ✅ Scenes: {len(scene_index)}")
    if clip_embeddings is not None:
        print(f"   ✅ CLIP coverage: {len(clip_embeddings)}/{len(scene_index)} scenes")
    
    # Initialize Gemini
    load_dotenv()
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY not found in .env")
    
    genai.configure(api_key=api_key)
    gemini_model = genai.GenerativeModel('gemini-2.0-flash')
    
    # Initialize cache
    cache = GeminiCache(cache_dir)
    
    # Initialize embedding model
    print("\n🧠 Loading embedding models...")
    device = cfg['models']['device']
    
    # Text-only model for semantic search
    text_model = SentenceTransformer('all-MiniLM-L6-v2', device=device)
    
    # CLIP model for text-image matching (same as video_indexer.py)
    clip_model_name = cfg['models']['clip_model']
    print(f"   Loading CLIP model: {clip_model_name}")
    clip_model = SentenceTransformer(clip_model_name, device=device)
    
    # Initialize components
    print("\n🎭 Initializing Director Agent...")
    analyzer = NarrativeContextAnalyzer(gemini_model, cache, frame_analyses)
    
    matcher = SmartFrameMatcher(cfg, text_model, frame_analyses, scene_index, 
                                clip_embeddings, clip_model)
    
    # Process transcript in windows
    print("\n🎯 Analyzing narrative context...")
    
    all_intents = []
    window_size = 5
    
    for i in tqdm(range(0, len(phrases), window_size), desc="Gemini analysis"):
        window_intents = analyzer.analyze_window(phrases, i, window_size)
        all_intents.extend(window_intents)
    
    # Ensure we have intent for every phrase
    while len(all_intents) < len(phrases):
        all_intents.append(VisualIntent(
            focus_entity='Unknown',
            secondary_entities=[],
            visual_action='medium shot',
            mood='neutral',
            setting='any',
            objects=[],
            context_window_id=len(all_intents)
        ))
    
    # Match frames
    print("\n🎬 Matching frames...")
    edit_plan = []
    
    for i, (phrase, intent) in enumerate(tqdm(list(zip(phrases, all_intents)), desc="Frame matching")):
        scene_id = matcher.match_phrase(phrase, intent, phrase_index=i)
        
        edit_plan.append({
            "phrase": phrase['text'],
            "start": phrase['start'],
            "end": phrase['end'],
            "duration": phrase['end'] - phrase['start'],
            "scene_id": scene_id,
            "visual_intent": asdict(intent),
            "scene_usage_count": matcher.scene_usage.get(scene_id, 0) if scene_id else 0
        })
    
    # Save
    print(f"\n💾 Saving edit plan...")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(edit_plan, f, ensure_ascii=False, indent=2)
    
    # Statistics
    print(f"\n✅ Edit plan saved: {output_file}")
    
    unique_scenes = len(matcher.scene_usage)
    max_usage = max(matcher.scene_usage.values()) if matcher.scene_usage else 0
    
    print(f"\n📈 Statistics:")
    print(f"   Total phrases: {len(edit_plan)}")
    print(f"   Unique scenes used: {unique_scenes}")
    print(f"   Max scene repetition: {max_usage}x")
    print(f"   Gemini cache hits: {len(list(cache.cache_dir.glob('*.json')))}")
    
    # Cooldown compliance check
    cooldown_violations = 0
    for i in range(len(edit_plan)):
        scene_id = edit_plan[i]['scene_id']
        if scene_id is None:
            continue
        
        # Check if this scene appears again within cooldown period
        for j in range(i + 1, min(i + 21, len(edit_plan))):  # Check next 20 phrases
            if edit_plan[j]['scene_id'] == scene_id:
                cooldown_violations += 1
                break
    
    print(f"   Cooldown period: {matcher.COOLDOWN_PERIOD} phrases")
    print(f"   Cooldown violations: {cooldown_violations}")
    
    # Calculate average spacing between repeats
    scene_positions = {}
    for i, item in enumerate(edit_plan):
        sid = item['scene_id']
        if sid is not None:
            if sid not in scene_positions:
                scene_positions[sid] = []
            scene_positions[sid].append(i)
    
    spacings = []
    for positions in scene_positions.values():
        if len(positions) > 1:
            for i in range(1, len(positions)):
                spacings.append(positions[i] - positions[i-1])
    
    if spacings:
        avg_spacing = sum(spacings) / len(spacings)
        min_spacing = min(spacings)
        print(f"   Average spacing between repeats: {avg_spacing:.1f} phrases")
        print(f"   Minimum spacing: {min_spacing} phrases")
    
    # Entity focus analysis
    focus_changes = 0
    for i in range(1, len(all_intents)):
        if all_intents[i].focus_entity != all_intents[i-1].focus_entity:
            focus_changes += 1
    
    print(f"\n🎭 Narrative Analysis:")
    print(f"   Focus entity changes: {focus_changes}")
    print(f"   Average focus duration: {len(phrases) / (focus_changes + 1):.1f} phrases")


if __name__ == "__main__":
    create_edit_plan()
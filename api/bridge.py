# -*- coding: utf-8 -*-
"""
Python-Electron Bridge
HTTP server that handles requests from UI
"""
import sys
import os
import re 
from pathlib import Path

# Add src directory to path
current_dir = Path(__file__).parent  # api/
project_root = current_dir.parent    # Sculptor/
src_dir = project_root / 'src'

sys.path.insert(0, str(src_dir))
sys.path.insert(0, str(project_root))

print(f"📁 Project root: {project_root}")
print(f"📁 Source directory: {src_dir}")

import json
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
import threading

# Import only what we need - NO pipeline.py
try:
    from project_manager import ProjectManager
    print("✅ Successfully imported ProjectManager")
except ImportError as e:
    print(f"❌ Import error: {e}")
    raise

app = Flask(__name__)
CORS(app)

# Allow large file uploads (10GB max)
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024 * 1024

# Global instances
project_manager = ProjectManager(projects_root=str(project_root / 'data' / 'projects'))

@app.route('/', methods=['GET'])
def index():
    """Root endpoint - API info"""
    return jsonify({
        'name': 'Sculptor Pro API',
        'version': '2.0.0',
        'status': 'running',
        'note': 'Pipeline orchestrated by UI, not backend'
    })

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok'})

@app.route('/projects', methods=['GET'])
def get_projects():
    """Get list of all projects"""
    try:
        projects = project_manager.list_projects()
        return jsonify({
            'success': True,
            'projects': projects
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/projects/upload', methods=['POST'])
def create_project_upload():
    """
    Create project with file upload (Browser mode) - MULTI-VIDEO SUPPORT
    Expects:
    - name: project name
    - videos[]: array of video files
    - voice: audio file
    """
    try:
        from werkzeug.utils import secure_filename
        
        project_name = request.form.get('name')
        video_files = request.files.getlist('videos[]')  # Multiple videos
        voice_file = request.files.get('voice')
        
        if not project_name:
            return jsonify({
                'success': False,
                'error': 'Project name is required'
            }), 400
        
        if not video_files or len(video_files) == 0:
            return jsonify({
                'success': False,
                'error': 'At least one video file is required'
            }), 400
        
        if not voice_file:
            return jsonify({
                'success': False,
                'error': 'Voice file is required'
            }), 400
        
        # Create project directory structure
        project_path = project_manager.create_project(project_name)
        
        # Directories
        videos_dir = project_path / 'input' / 'videos'
        audio_dir = project_path / 'input' / 'audio'
        
        videos_dir.mkdir(parents=True, exist_ok=True)
        audio_dir.mkdir(parents=True, exist_ok=True)
        
        # Save all video files with index naming
        print(f"📹 Saving {len(video_files)} videos...")
        for index, video_file in enumerate(video_files):
            # Get file extension
            original_name = secure_filename(video_file.filename)
            extension = Path(original_name).suffix
            
            # Save as video_000.mp4, video_001.mp4, etc.
            video_filename = f"video_{index:03d}{extension}"
            video_path = videos_dir / video_filename
            
            video_file.save(str(video_path))
            print(f"   ✅ Saved: {video_filename} ({video_file.content_length / (1024*1024):.1f} MB)")
        
        # Save voice file
        voice_filename = "voice.mp3"
        voice_path = audio_dir / voice_filename
        voice_file.save(str(voice_path))
        print(f"   ✅ Saved: {voice_filename}")
        
        # Create/Update manifest with video info
        manifest_path = project_path / 'project.json'
        
        manifest = {
            'name': project_name,
            'created_at': str(project_path),
            'videos': [],
            'audio_file': voice_filename
        }
        
        for index, video_file in enumerate(video_files):
            original_name = secure_filename(video_file.filename)
            extension = Path(original_name).suffix
            video_filename = f"video_{index:03d}{extension}"
            
            manifest['videos'].append({
                'index': index,
                'filename': video_filename,
                'original_name': original_name
            })
        
        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        
        # Update config to use this project
        project_manager.update_config(project_name)
        
        print(f"✅ Project created: {project_name} ({len(video_files)} videos)")
        
        return jsonify({
            'success': True,
            'project': {
                'name': project_name,
                'path': str(project_path),
                'video_count': len(video_files)
            }
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/projects/<project_name>', methods=['DELETE'])
def delete_project(project_name):
    """Delete a project"""
    try:
        import shutil
        project_path = project_manager.projects_root / project_name
        
        if project_path.exists():
            shutil.rmtree(project_path)
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/projects/<project_name>/status', methods=['GET'])
def get_project_status(project_name):
    """Get project processing status"""
    try:
        info = project_manager.get_project_info(project_name)
        return jsonify({
            'success': True,
            'status': info
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/projects/<project_name>/videos', methods=['GET'])
def get_project_videos(project_name):
    """Get list of videos in project"""
    try:
        manifest = project_manager.get_project_manifest(project_name)
        videos = manifest.get('videos', [])
        
        return jsonify({
            'success': True,
            'videos': videos
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/projects/<project_name>/video/<int:video_index>', methods=['GET'])
def get_project_video(project_name, video_index):
    """
    Stream a specific video file with HTTP Range support
    video_index: 0, 1, 2, etc.
    """
    try:
        project_path = project_manager.projects_root / project_name
        manifest = project_manager.get_project_manifest(project_name)
        
        videos = manifest.get('videos', [])
        video_info = next((v for v in videos if v['index'] == video_index), None)
        
        if not video_info:
            return f"Video {video_index} not found", 404
        
        video_path = project_path / 'input' / 'videos' / video_info['filename']
        
        if not video_path.exists():
            return f"Video file not found: {video_info['filename']}", 404
        
        # Support for HTTP Range requests (critical for video streaming)
        range_header = request.headers.get('Range', None)
        
        if not range_header:
            return send_file(str(video_path), mimetype='video/mp4')
        
        # Handle Range request for streaming
        size = os.path.getsize(video_path)
        byte1, byte2 = 0, None
        
        m = re.search(r'(\d+)-(\d*)', range_header)
        g = m.groups()
        
        if g[0]:
            byte1 = int(g[0])
        if g[1]:
            byte2 = int(g[1])
        
        length = size - byte1
        if byte2 is not None:
            length = byte2 + 1 - byte1
        
        data = None
        with open(video_path, 'rb') as f:
            f.seek(byte1)
            data = f.read(length)
        
        rv = Response(data, 206, mimetype='video/mp4', direct_passthrough=True)
        rv.headers.add('Content-Range', f'bytes {byte1}-{byte1 + length - 1}/{size}')
        rv.headers.add('Accept-Ranges', 'bytes')
        return rv
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return str(e), 500

# ============================================================================
# PIPELINE STEP EXECUTION - Individual steps run by UI
# ============================================================================

@app.route('/pipeline/step', methods=['POST'])
def run_step():
    """
    Run a single pipeline step
    UI orchestrates the full pipeline by calling this endpoint sequentially
    """
    try:
        data = request.json
        step_name = data.get('step')
        project_name = data.get('project')
        movie_title = data.get('movieTitle')  # Optional, only for scene analysis
        
        if not step_name or not project_name:
            return jsonify({
                'success': False,
                'error': 'Missing step or project name'
            }), 400
        
        # Update config to use this project
        project_manager.update_config(project_name)
        
        # Map step names to functions
        step_map = {
            'audio': run_audio_step,
            'video': run_video_step,
            'scene': run_scene_step,
            'matcher': run_matcher_step
        }
        
        if step_name not in step_map:
            return jsonify({
                'success': False,
                'error': f'Unknown step: {step_name}'
            }), 400
        
        # Check if movie title is required
        if step_name == 'scene' and not movie_title:
            return jsonify({
                'success': False,
                'error': 'Movie title is required for scene analysis',
                'requires_input': True,
                'input_type': 'movie_title'
            }), 400
        
        # Run the step function
        result = step_map[step_name](movie_title)
        
        return jsonify({
            'success': True,
            'step': step_name,
            'message': result
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def run_audio_step(movie_title=None):
    """Audio Transcription + Optimization"""
    from audio_transcriber import transcribe_audio
    from transcript_optimizer import optimize_transcript
    
    print("🎤 Step 1/4: Audio Transcription")
    transcribe_audio()
    
    print("🎯 Step 1/4: Transcript Optimization")
    optimize_transcript()
    
    return "Audio processing complete"

def run_video_step(movie_title=None):
    """Video Indexing + Scene Detection (MULTI-VIDEO)"""
    from video_indexer import run_indexer
    
    print("🎬 Step 2/4: Video Indexing (Multi-video support)")
    run_indexer()
    
    return "Video indexing complete"

def run_scene_step(movie_title):
    """Scene Analysis + Expansion (requires movie title)"""
    from frame_analyzer import analyze_frames
    from frame_expander import expand_frame_analysis
    
    print(f"🎨 Step 3/4: Frame Analysis (movie: {movie_title})")
    analyze_frames(movie_title=movie_title)
    
    print("🎨 Step 3/4: Frame Expansion")
    expand_frame_analysis()
    
    return "Scene analysis complete"

def run_matcher_step(movie_title=None):
    """Smart Matching"""
    from smart_matcher import create_edit_plan
    
    print("🧠 Step 4/4: Smart Matcher")
    create_edit_plan()
    
    return "Smart matching complete"

# ============================================================================
# SCENE TIMING FIX
# ============================================================================

@app.route('/pipeline/fix-timings', methods=['POST'])
def fix_scene_timings():
    """Automatically fix scene timings after video indexing"""
    try:
        data = request.json
        project_name = data.get('project')
        offset = data.get('offset')  # None = use default 0.2
        
        # Update config to use this project
        project_manager.update_config(project_name)
        
        # Import and run fixer
        from scene_timing_fixer import fix_timings_for_project
        
        stats = fix_timings_for_project(project_name, offset)
        
        return jsonify({
            'success': True,
            'stats': stats
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ============================================================================
# EXPORT
# ============================================================================

@app.route('/export', methods=['POST'])
def export_xml():
    """Export to Premiere Pro XML"""
    try:
        data = request.json
        project_name = data.get('project')
        
        # Update config
        project_manager.update_config(project_name)
        
        # Run export
        from xml_exporter import export_to_premiere
        export_to_premiere()
        
        return jsonify({
            'success': True
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ============================================================================
# PREVIEW ENDPOINTS
# ============================================================================

@app.route('/projects/<project_name>/edit-plan', methods=['GET'])
def get_edit_plan(project_name):
    """Get edit plan for preview"""
    try:
        project_path = project_manager.projects_root / project_name
        edit_plan_file = project_path / 'cache' / 'edit_plan.json'
        
        if not edit_plan_file.exists():
            return jsonify({
                'success': False,
                'error': 'Edit plan not found'
            }), 404
        
        with open(edit_plan_file, 'r', encoding='utf-8') as f:
            plan = json.load(f)
        
        return jsonify({
            'success': True,
            'plan': plan
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/projects/<project_name>/voice.mp3', methods=['GET'])
def get_voice(project_name):
    """Get voice audio file"""
    try:
        project_path = project_manager.projects_root / project_name
        
        # Try new location first (audio/voice.mp3)
        voice_path = project_path / 'input' / 'audio' / 'voice.mp3'
        
        # Fallback to old location (input/voice.mp3)
        if not voice_path.exists():
            voice_path = project_path / 'input' / 'voice.mp3'
        
        if not voice_path.exists():
            return "Voice file not found", 404
        
        return send_file(str(voice_path), mimetype='audio/mpeg')
        
    except Exception as e:
        return str(e), 500

@app.route('/projects/<project_name>/scene-index', methods=['GET'])
def get_scene_index(project_name):
    """Get scene index for accurate video timecodes"""
    try:
        project_path = project_manager.projects_root / project_name
        scene_index_file = project_path / 'cache' / 'scene_index.json'
        
        if not scene_index_file.exists():
            return jsonify({
                'success': False,
                'error': 'Scene index not found'
            }), 404
        
        with open(scene_index_file, 'r', encoding='utf-8') as f:
            scenes = json.load(f)
        
        return jsonify({
            'success': True,
            'scenes': scenes
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    print('🚀 Sculptor Pro API v2.0 (Multi-video support)')
    print('📍 URL: http://localhost:5000')
    print('📍 Health: http://localhost:5000/health')
    print('💡 Pipeline is now orchestrated by UI, not backend')
    print('\n🔧 Starting Flask server...\n')
    
    try:
        app.run(host='127.0.0.1', port=5000, debug=False, use_reloader=False)
    except Exception as e:
        print(f'\n❌ Failed to start server: {e}')
        import traceback
        traceback.print_exc()

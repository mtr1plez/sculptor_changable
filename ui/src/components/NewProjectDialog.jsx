import React, { useState } from 'react';
import { Folder, X, AlertCircle } from 'lucide-react';
import pythonBridge from '../utils/pythonBridge';

export default function NewProjectDialog({ onClose, onProjectCreated }) {
  const [projectName, setProjectName] = useState('');
  const [moviePath, setMoviePath] = useState('');
  const [voicePath, setVoicePath] = useState('');
  const [movieFile, setMovieFile] = useState(null);
  const [voiceFile, setVoiceFile] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  const selectFile = async (type) => {
    try {
      // Check if running in Electron
      if (window.electronAPI?.selectFile) {
        const path = await window.electronAPI.selectFile(type);
        if (path) {
          if (type === 'video') {
            setMoviePath(path);
          } else {
            setVoicePath(path);
          }
        }
      } else {
        // Fallback for browser: use HTML file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = type === 'video' 
          ? '.mp4,.mkv,.avi,.mov' 
          : '.mp3,.wav,.aac,.m4a';
        
        input.onchange = (e) => {
          const file = e.target.files[0];
          if (file) {
            if (type === 'video') {
              setMoviePath(file.name);
              setMovieFile(file);
            } else {
              setVoicePath(file.name);
              setVoiceFile(file);
            }
          }
        };
        
        input.click();
      }
    } catch (err) {
      console.error('File selection error:', err);
    }
  };

  const handleCreate = async () => {
    setError(null);

    // Validation
    if (!projectName.trim()) {
      setError('Project name is required');
      return;
    }

    if (!moviePath) {
      setError('Please select a movie file');
      return;
    }

    if (!voicePath) {
      setError('Please select a voice file');
      return;
    }

    try {
      setCreating(true);
      
      // In browser mode, upload files via FormData
      if (movieFile && voiceFile) {
        const formData = new FormData();
        formData.append('name', projectName.trim());
        formData.append('movie', movieFile);
        formData.append('voice', voiceFile);
        
        const response = await fetch('http://127.0.0.1:5000/projects/upload', {
          method: 'POST',
          body: formData
        });
        
        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const text = await response.text();
          console.error('Non-JSON response:', text);
          throw new Error('Server returned non-JSON response. Check console for details.');
        }
        
        const result = await response.json();
        
        if (result.success) {
          onProjectCreated(result.project);
        } else {
          setError(result.error || 'Failed to create project');
        }
      } else {
        // Electron mode - paths are real
        const result = await pythonBridge.createProject(
          projectName.trim(),
          moviePath,
          voicePath
        );

        if (result.success) {
          onProjectCreated(result.project);
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to create project');
      console.error('Create project error:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !creating) {
      handleCreate();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-lg w-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 className="text-xl font-bold text-white">New Project</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-700 rounded transition"
            disabled={creating}
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* Error Alert */}
          {error && (
            <div className="flex items-start gap-3 p-4 bg-red-900 bg-opacity-20 border border-red-800 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            </div>
          )}

          {/* Project Name */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Project Name *
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="e.g., The Girl with the Dragon Tattoo"
              className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              disabled={creating}
              autoFocus
            />
          </div>

          {/* Movie File */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Movie File *
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={moviePath}
                onChange={(e) => setMoviePath(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Select movie.mp4..."
                className="flex-1 px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                disabled={creating}
              />
              <button
                onClick={() => selectFile('video')}
                disabled={creating}
                className="px-4 py-3 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Folder className="w-5 h-5 text-gray-300" />
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Supported formats: MP4, MKV, AVI, MOV
            </p>
          </div>

          {/* Voice File */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Voice File *
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={voicePath}
                onChange={(e) => setVoicePath(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Select voice.mp3..."
                className="flex-1 px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                disabled={creating}
              />
              <button
                onClick={() => selectFile('audio')}
                disabled={creating}
                className="px-4 py-3 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Folder className="w-5 h-5 text-gray-300" />
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Supported formats: MP3, WAV, AAC, M4A
            </p>
          </div>

          {/* Info Box */}
          <div className="p-4 bg-blue-900 bg-opacity-20 border border-blue-800 rounded-lg">
            <p className="text-sm text-blue-300">
              <span className="font-medium">💡 Tip:</span> Files will be copied to the project directory and renamed to movie.mp4 and voice.mp3
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-gray-700">
          <button
            onClick={onClose}
            disabled={creating}
            className="flex-1 px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !projectName.trim() || !moviePath || !voicePath}
            className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition disabled:cursor-not-allowed"
          >
            {creating ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Creating...
              </span>
            ) : (
              'Create Project'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
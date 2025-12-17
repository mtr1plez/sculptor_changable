import React, { useState } from 'react';
import { Folder, X, AlertCircle, Plus, Trash2, Film } from 'lucide-react';
import pythonBridge from '../utils/pythonBridge';

export default function NewProjectDialog({ onClose, onProjectCreated }) {
  const [projectName, setProjectName] = useState('');
  const [videos, setVideos] = useState([]); // Array of { file, name, size, id }
  const [voiceFile, setVoiceFile] = useState(null);
  const [voicePath, setVoicePath] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  const selectVideos = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true; // MULTIPLE FILES
    input.accept = '.mp4,.mkv,.avi,.mov';
    
    input.onchange = (e) => {
      const files = Array.from(e.target.files);
      if (files.length > 0) {
        const newVideos = files.map((file, index) => ({
          file,
          name: file.name,
          size: (file.size / (1024 * 1024)).toFixed(2) + ' MB',
          id: Date.now() + index
        }));
        setVideos(prev => [...prev, ...newVideos]);
      }
    };
    
    input.click();
  };

  const removeVideo = (videoId) => {
    setVideos(prev => prev.filter(v => v.id !== videoId));
  };

  const selectVoice = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mp3,.wav,.aac,.m4a';
    
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        setVoicePath(file.name);
        setVoiceFile(file);
      }
    };
    
    input.click();
  };

  const handleCreate = async () => {
    setError(null);

    // Validation
    if (!projectName.trim()) {
      setError('Project name is required');
      return;
    }

    if (videos.length === 0) {
      setError('Please select at least one video file');
      return;
    }

    if (!voiceFile) {
      setError('Please select a voice file');
      return;
    }

    try {
      setCreating(true);
      
      // Upload via FormData
      const formData = new FormData();
      formData.append('name', projectName.trim());
      
      // Add all videos
      videos.forEach(video => {
        formData.append('videos[]', video.file);
      });
      
      formData.append('voice', voiceFile);
      
      const response = await fetch('http://127.0.0.1:5000/projects/upload', {
        method: 'POST',
        body: formData
      });
      
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

  const totalSize = videos.reduce((sum, v) => {
    return sum + parseFloat(v.size);
  }, 0).toFixed(2);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-2xl w-full shadow-2xl max-h-[90vh] flex flex-col">
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

        {/* Body - Scrollable */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
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
              placeholder="e.g., Harry Potter Series"
              className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              disabled={creating}
              autoFocus
            />
          </div>

          {/* Video Files */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Video Files * {videos.length > 0 && `(${videos.length} files, ${totalSize} MB)`}
            </label>
            
            {/* Video List */}
            {videos.length > 0 && (
              <div className="mb-3 space-y-2 max-h-48 overflow-y-auto bg-gray-900 rounded-lg p-3">
                {videos.map((video, index) => (
                  <div
                    key={video.id}
                    className="flex items-center justify-between p-2 bg-gray-800 rounded group"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded flex items-center justify-center text-white text-sm font-medium">
                        {index + 1}
                      </div>
                      <Film className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{video.name}</p>
                        <p className="text-xs text-gray-500">{video.size}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeVideo(video.id)}
                      disabled={creating}
                      className="p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <button
              onClick={selectVideos}
              disabled={creating}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-5 h-5" />
              {videos.length === 0 ? 'Select Videos' : 'Add More Videos'}
            </button>
            
            <p className="text-xs text-gray-500 mt-1">
              💡 You can select multiple videos at once. Supported: MP4, MKV, AVI, MOV
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
                readOnly
              />
              <button
                onClick={selectVoice}
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
              <span className="font-medium">💡 Multi-video support:</span> All videos will be indexed and available for matching. Perfect for series, multi-part movies, or documentaries!
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
            disabled={creating || !projectName.trim() || videos.length === 0 || !voiceFile}
            className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition disabled:cursor-not-allowed"
          >
            {creating ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Creating...
              </span>
            ) : (
              `Create Project (${videos.length} video${videos.length !== 1 ? 's' : ''})`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

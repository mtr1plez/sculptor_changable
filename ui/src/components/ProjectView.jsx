import React, { useState, useEffect } from 'react';
import { ChevronLeft, Folder as FolderIcon } from 'lucide-react';
import StepRunner from './StepRunner';
import VideoPreview from './VideoPreview';
import ConsoleLog from './ConsoleLog';
import pythonBridge from '../utils/pythonBridge';

export default function ProjectView({ projectName, onBack }) {
  const [projectStatus, setProjectStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    loadProjectStatus();
  }, [projectName]);

  const loadProjectStatus = async () => {
    try {
      setLoading(true);
      const result = await pythonBridge.getProjectStatus(projectName);
      setProjectStatus(result.status);
    } catch (err) {
      addLog(`Error loading project: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { timestamp, message, type }]);
  };

  const openProjectFolder = () => {
    if (projectStatus?.path) {
      // Use Electron API to open folder
      window.electronAPI?.openFolder?.(projectStatus.path);
    }
  };

  const calculateProgress = () => {
    if (!projectStatus) return 0;
    
    const steps = [
      projectStatus.has_transcript,
      projectStatus.has_frames,
      projectStatus.has_embeddings,
      projectStatus.has_characters,
      projectStatus.has_edit_plan
    ];
    
    const completed = steps.filter(Boolean).length;
    return Math.round((completed / steps.length) * 100);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-400">Loading project...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-850">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition"
          >
            <ChevronLeft className="w-5 h-5" />
            Back to Project Manager
          </button>
          
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-semibold">{projectName}</h2>
            <button
              onClick={openProjectFolder}
              className="p-2 text-gray-400 hover:text-white transition"
              title="Open Project Folder"
            >
              <FolderIcon className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-sm text-gray-400">
              Progress: <span className="text-white font-medium">{calculateProgress()}%</span>
            </div>
            <div className="w-32 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-500"
                style={{ width: `${calculateProgress()}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto p-6">
        <div className="grid grid-cols-2 gap-6">
          {/* Left Panel: Controls */}
          <div className="space-y-6">
            <StepRunner
              projectName={projectName}
              projectStatus={projectStatus}
              onLog={addLog}
              onStatusUpdate={loadProjectStatus}
            />
            
            <ConsoleLog logs={logs} />
          </div>

          {/* Right Panel: Preview */}
          <div>
            <VideoPreview
              projectName={projectName}
              projectStatus={projectStatus}
              progress={calculateProgress()}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
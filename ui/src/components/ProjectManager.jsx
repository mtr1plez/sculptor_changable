import React, { useState, useEffect } from 'react';
import { Film, Plus, Folder, Trash2 } from 'lucide-react';
import pythonBridge from '../utils/pythonBridge';

export default function ProjectManager({ onSelectProject }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      setLoading(true);
      const result = await pythonBridge.getProjects();
      setProjects(result.projects || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (projectName) => {
    if (!confirm(`Delete project "${projectName}"? This will remove all data.`)) {
      return;
    }

    try {
      await pythonBridge.deleteProject(projectName);
      await loadProjects();
    } catch (err) {
      alert(`Failed to delete project: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-400">Loading projects...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 mb-4">Error: {error}</p>
          <button
            onClick={loadProjects}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Film className="w-10 h-10 text-blue-500" />
          <h1 className="text-3xl font-bold">Sculptor Pro</h1>
        </div>

        <h2 className="text-xl mb-6">Welcome to Sculptor!</h2>

        {/* Buttons */}
        <div className="flex gap-4 mb-8">
          <button
            onClick={() => onSelectProject('new')}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition"
          >
            <Plus className="w-5 h-5" />
            New Project
          </button>
          <button className="flex items-center gap-2 px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-medium transition">
            <Folder className="w-5 h-5" />
            Open Project
          </button>
        </div>

        {/* Project List */}
        <div className="space-y-4">
          <h3 className="text-sm text-gray-400 uppercase tracking-wider">Projects</h3>
          
          {projects.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p>No projects yet</p>
              <p className="text-sm mt-2">Click "New Project" to get started</p>
            </div>
          ) : (
            projects.map(project => (
              <div
                key={project}
                className="flex items-center justify-between p-4 bg-gray-800 hover:bg-gray-750 rounded-lg cursor-pointer transition group"
                onClick={() => onSelectProject(project)}
              >
                <div className="flex-1">
                  <h4 className="font-medium">{project}</h4>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(project);
                  }}
                  className="p-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
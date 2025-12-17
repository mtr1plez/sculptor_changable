const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Pipeline operations
  runPipeline: (options) => ipcRenderer.invoke('run-pipeline', options),
  runStep: (stepId) => ipcRenderer.invoke('run-step', stepId),
  
  // Project management
  getProjects: () => ipcRenderer.invoke('get-projects'),
  createProject: (projectData) => ipcRenderer.invoke('create-project', projectData),
  deleteProject: (projectId) => ipcRenderer.invoke('delete-project', projectId),
  
  // File operations
  selectFile: (fileType) => ipcRenderer.invoke('select-file', fileType),
  
  // Event listeners
  onPipelineProgress: (callback) => {
    ipcRenderer.on('pipeline-progress', (event, data) => callback(data));
  },
  onStepComplete: (callback) => {
    ipcRenderer.on('step-complete', (event, data) => callback(data));
  },
  onLog: (callback) => {
    ipcRenderer.on('log', (event, message) => callback(message));
  }
});
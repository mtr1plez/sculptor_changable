/**
 * Python Bridge Utility
 * Communicates with Python backend via HTTP
 */

const API_BASE = 'http://127.0.0.1:5000';

class PythonBridge {
  async request(endpoint, method = 'GET', data = null) {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      options.body = JSON.stringify(data);
      console.log(`API Request: ${method} ${endpoint}`, data); // DEBUG
    }

    const response = await fetch(`${API_BASE}${endpoint}`, options);
    
    console.log(`API Response: ${response.status}`, response); // DEBUG
    
    const result = await response.json();
    
    console.log('API Result:', result); // DEBUG

    if (!result.success) {
      throw new Error(result.error || 'Unknown error');
    }

    return result;
  }

  // Project Management
  async getProjects() {
    return this.request('/projects');
  }

  async createProject(name, moviePath, voicePath) {
    return this.request('/projects', 'POST', {
      name,
      moviePath,
      voicePath
    });
  }

  async fixSceneTimings(projectName, offset = null) {
  // offset = null означает использовать дефолтный 0.2s
  return this.request('/pipeline/fix-timings', 'POST', {
    project: projectName,
    offset: offset
  });
}

  async deleteProject(projectName) {
    return this.request(`/projects/${projectName}`, 'DELETE');
  }

  async getProjectStatus(projectName) {
    return this.request(`/projects/${projectName}/status`);
  }

  // Pipeline Operations
  async runPipeline(projectName, force = false) {
    return this.request('/pipeline/run', 'POST', {
      project: projectName,
      force
    });
  }

  async runStep(stepName, projectName, movieTitle = null) {
    const payload = {
      step: stepName,
      project: projectName
    };
    
    if (movieTitle) {
      payload.movieTitle = movieTitle;
    }
    
    return this.request('/pipeline/step', 'POST', payload);
  }

  async exportXML(projectName) {
    return this.request('/export', 'POST', {
      project: projectName
    });
  }

  // Health Check
  async checkHealth() {
    try {
      const response = await fetch(`${API_BASE}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

export default new PythonBridge();
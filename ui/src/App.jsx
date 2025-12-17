import React, { useState } from 'react';
import ProjectManager from './components/ProjectManager';
import NewProjectDialog from './components/NewProjectDialog';
import ProjectView from './components/ProjectView';

function App() {
  const [screen, setScreen] = useState('manager'); // 'manager' | 'project'
  const [currentProject, setCurrentProject] = useState(null);
  const [showNewProject, setShowNewProject] = useState(false);

  const handleSelectProject = (project) => {
    if (project === 'new') {
      setShowNewProject(true);
    } else {
      setCurrentProject(project);
      setScreen('project');
    }
  };

  const handleProjectCreated = (project) => {
    setShowNewProject(false);
    setCurrentProject(project.name);
    setScreen('project');
  };

  const handleBackToManager = () => {
    setCurrentProject(null);
    setScreen('manager');
  };

  return (
    <>
      {screen === 'manager' && (
        <ProjectManager onSelectProject={handleSelectProject} />
      )}

      {screen === 'project' && currentProject && (
        <ProjectView
          projectName={currentProject}
          onBack={handleBackToManager}
        />
      )}

      {showNewProject && (
        <NewProjectDialog
          onClose={() => setShowNewProject(false)}
          onProjectCreated={handleProjectCreated}
        />
      )}
    </>
  );
}

export default App;
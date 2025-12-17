import React, { useState } from 'react';
import { Play, ChevronRight, CheckCircle, Circle, Loader, XCircle, FileVideo } from 'lucide-react';
import pythonBridge from '../utils/pythonBridge';
import MovieTitleDialog from './MovieTitleDialog';

const PIPELINE_STEPS = [
  {
    id: 'audio',
    name: 'Audio Transcription',
    description: 'Whisper + optimization',
    icon: '🎤'
  },
  {
    id: 'video',
    name: 'Video Indexing',
    description: 'Scene detection + CLIP + timing fix',
    icon: '🎬'
  },
  {
    id: 'scene',
    name: 'Scene Analysis',
    description: 'Gemini frame analysis + expansion',
    icon: '🎨',
    requiresMovieTitle: true
  },
  {
    id: 'matcher',
    name: 'Smart Matcher',
    description: 'AI-powered narrative matching',
    icon: '🧠'
  }
];

export default function StepRunner({ projectName, projectStatus, onLog, onStatusUpdate }) {
  const [runningStep, setRunningStep] = useState(null);
  const [runningFullPipeline, setRunningFullPipeline] = useState(false);
  const [currentPipelineStep, setCurrentPipelineStep] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [showMovieTitleDialog, setShowMovieTitleDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // 'single' | 'full'
  const [pendingStepId, setPendingStepId] = useState(null);

  const getStepStatus = (stepId) => {
    if (!projectStatus) return 'idle';
    
    const statusMap = {
      audio: projectStatus.has_transcript,
      video: projectStatus.has_frames && projectStatus.has_embeddings,
      scene: projectStatus.has_characters,
      matcher: projectStatus.has_edit_plan
    };
    
    if (runningStep === stepId) {
      return 'running';
    }
    
    if (runningFullPipeline) {
      const stepIndex = PIPELINE_STEPS.findIndex(s => s.id === stepId);
      if (stepIndex < currentPipelineStep) return 'completed';
      if (stepIndex === currentPipelineStep) return 'running';
    }
    
    return statusMap[stepId] ? 'completed' : 'idle';
  };

  const StatusIcon = ({ status }) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'running':
        return <Loader className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <Circle className="w-5 h-5 text-gray-500" />;
    }
  };

  // ============================================================================
  // FULL PIPELINE ORCHESTRATION
  // ============================================================================
  const startFullPipeline = () => {
    setPendingAction('full');
    setShowMovieTitleDialog(true);
  };

  const runFullPipelineWithMovieTitle = async (movieTitle) => {
    try {
      setRunningFullPipeline(true);
      setCurrentPipelineStep(0);
      onLog('🚀 Starting full Sculptor pipeline...', 'info');

      // Step 1: Audio (Transcription + Optimization)
      await runPipelineStep(0, 'audio', null);

      // Step 2: Video (Indexing + Scene Detection + Timing Fix)
      await runPipelineStep(1, 'video', null);

      // Step 3: Scene Analysis (with movie title)
      await runPipelineStep(2, 'scene', movieTitle);

      // Step 4: Smart Matcher
      await runPipelineStep(3, 'matcher', null);

      // Success!
      onLog('🎉 Full pipeline completed successfully!', 'success');
      setRunningFullPipeline(false);
      setCurrentPipelineStep(0);
      
      // Final status update
      await onStatusUpdate();
      
    } catch (err) {
      onLog(`❌ Pipeline failed: ${err.message}`, 'error');
      setRunningFullPipeline(false);
      setCurrentPipelineStep(0);
    }
  };

  const runPipelineStep = async (stepIndex, stepId, movieTitle) => {
    const step = PIPELINE_STEPS.find(s => s.id === stepId);
    
    try {
      setCurrentPipelineStep(stepIndex);
      onLog(`⏳ Running ${step.name}...`, 'info');
      
      const result = await pythonBridge.runStep(stepId, projectName, movieTitle);
      
      if (result.success) {
        onLog(`✅ ${step.name} completed`, 'success');
        
        // Auto-fix timings after video indexing
        if (stepId === 'video') {
          onLog('🔧 Fixing scene timings...', 'info');
          try {
            const fixResult = await pythonBridge.fixSceneTimings(projectName, null);
            if (fixResult.success) {
              const { fixed, total } = fixResult.stats;
              onLog(`✅ Scene timings fixed: ${fixed}/${total} scenes`, 'success');
            }
          } catch (err) {
            onLog(`⚠️ Timing fix warning: ${err.message}`, 'warning');
          }
        }
        
        // Update status after each step
        await onStatusUpdate();
        
      } else {
        throw new Error(result.error || 'Step failed');
      }
    } catch (err) {
      throw new Error(`${step.name} failed: ${err.message}`);
    }
  };

  // ============================================================================
  // SINGLE STEP EXECUTION
  // ============================================================================
  const runSingleStep = async (stepId) => {
    const step = PIPELINE_STEPS.find(s => s.id === stepId);
    
    // If step requires movie title, show dialog
    if (step.requiresMovieTitle) {
      setPendingAction('single');
      setPendingStepId(stepId);
      setShowMovieTitleDialog(true);
      return;
    }
    
    // Otherwise run directly
    await executeSingleStep(stepId, null);
  };

  const executeSingleStep = async (stepId, movieTitle) => {
    try {
      setRunningStep(stepId);
      const step = PIPELINE_STEPS.find(s => s.id === stepId);
      onLog(`⏳ Running ${step.name}...`, 'info');
      
      const result = await pythonBridge.runStep(stepId, projectName, movieTitle);
      
      if (result.success) {
        onLog(`✅ ${step.name} completed`, 'success');
        
        // Auto-fix timings after video indexing
        if (stepId === 'video') {
          onLog('🔧 Fixing scene timings...', 'info');
          try {
            const fixResult = await pythonBridge.fixSceneTimings(projectName, null);
            if (fixResult.success) {
              const { fixed, total } = fixResult.stats;
              onLog(`✅ Scene timings fixed: ${fixed}/${total} scenes`, 'success');
            }
          } catch (err) {
            onLog(`⚠️ Timing fix warning: ${err.message}`, 'warning');
          }
        }
        
        // Update status
        setTimeout(async () => {
          await onStatusUpdate();
          setRunningStep(null);
        }, 1000);
      }
    } catch (err) {
      onLog(`❌ ${PIPELINE_STEPS.find(s => s.id === stepId)?.name} failed: ${err.message}`, 'error');
      setRunningStep(null);
    }
  };

  // ============================================================================
  // MOVIE TITLE DIALOG HANDLERS
  // ============================================================================
  const handleMovieTitleSubmit = (movieTitle) => {
    setShowMovieTitleDialog(false);
    
    if (pendingAction === 'full') {
      // Run full pipeline
      runFullPipelineWithMovieTitle(movieTitle);
    } else if (pendingAction === 'single' && pendingStepId) {
      // Run single step
      executeSingleStep(pendingStepId, movieTitle);
    }
    
    // Reset pending state
    setPendingAction(null);
    setPendingStepId(null);
  };

  const handleMovieTitleCancel = () => {
    setShowMovieTitleDialog(false);
    setPendingAction(null);
    setPendingStepId(null);
  };

  // ============================================================================
  // EXPORT
  // ============================================================================
  const handleExport = async () => {
    try {
      setExporting(true);
      onLog('📝 Exporting to XML...', 'info');
      
      const result = await pythonBridge.exportXML(projectName);
      
      if (result.success) {
        onLog('✅ XML export completed', 'success');
      }
    } catch (err) {
      onLog(`❌ Export failed: ${err.message}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const canExport = projectStatus?.has_edit_plan && !runningFullPipeline && !runningStep;
  const isAnyProcessRunning = runningFullPipeline || runningStep;

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div className="space-y-4">
      {/* Movie Title Dialog */}
      {showMovieTitleDialog && (
        <MovieTitleDialog
          onSubmit={handleMovieTitleSubmit}
          onCancel={handleMovieTitleCancel}
        />
      )}

      {/* START SCULPTOR - Full Pipeline */}
      <div className="bg-gray-800 p-6 rounded-lg">
        <button
          onClick={startFullPipeline}
          disabled={isAnyProcessRunning}
          className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition text-lg disabled:cursor-not-allowed"
        >
          <Play className="w-6 h-6" />
          {runningFullPipeline ? 'Running Pipeline...' : 'Start Sculptor'}
        </button>
        
        {runningFullPipeline && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">
                Step {currentPipelineStep + 1} of {PIPELINE_STEPS.length}
              </span>
              <span className="text-sm text-blue-400">
                {PIPELINE_STEPS[currentPipelineStep]?.name}
              </span>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-500"
                style={{ 
                  width: `${((currentPipelineStep + 1) / PIPELINE_STEPS.length) * 100}%` 
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* MANUAL STEPS */}
      <div className="bg-gray-800 p-6 rounded-lg">
        <div className="flex items-center gap-2 mb-4">
          <ChevronRight className="w-5 h-5 text-gray-400" />
          <h3 className="text-lg font-semibold">Run Steps Manually</h3>
        </div>
        
        <div className="space-y-3">
          {PIPELINE_STEPS.map((step, index) => {
            const status = getStepStatus(step.id);
            const isRunning = status === 'running';
            const isDisabled = isAnyProcessRunning && !isRunning;
            
            return (
              <div key={step.id} className="space-y-2">
                <button
                  onClick={() => runSingleStep(step.id)}
                  disabled={isDisabled}
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-750 disabled:cursor-not-allowed rounded-lg transition group"
                >
                  <div className="flex items-center gap-3">
                    <StatusIcon status={status} />
                    <div className="text-left">
                      <div className="font-medium flex items-center gap-2">
                        <span>{step.icon}</span>
                        <span>{step.name}</span>
                      </div>
                      <div className="text-xs text-gray-400">{step.description}</div>
                    </div>
                  </div>
                  {isRunning && (
                    <span className="text-sm text-blue-400 animate-pulse">Running...</span>
                  )}
                </button>
                
                {isRunning && !runningFullPipeline && (
                  <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 animate-pulse" style={{ width: '100%' }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* EXPORT TO XML */}
      <div className="bg-gray-800 p-6 rounded-lg">
        <button
          onClick={handleExport}
          disabled={!canExport || exporting}
          className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition disabled:cursor-not-allowed"
        >
          <FileVideo className="w-5 h-5" />
          {exporting ? 'Exporting...' : 'Export to Premiere Pro XML'}
        </button>
        {!canExport && (
          <p className="text-xs text-gray-500 mt-2 text-center">
            Complete all steps first
          </p>
        )}
      </div>
    </div>
  );
}
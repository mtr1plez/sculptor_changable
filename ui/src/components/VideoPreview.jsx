import React, { useState, useEffect, useRef } from 'react';
import { Eye, PlayCircle, PauseCircle, AlertCircle, Maximize2, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';

export default function VideoPreview({ projectName, projectStatus, progress }) {
  const [showPlayer, setShowPlayer] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [editPlan, setEditPlan] = useState(null);
  const [sceneIndex, setSceneIndex] = useState(null);
  const [currentClipIndex, setCurrentClipIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const animationFrameRef = useRef(null);
  const lastClipIndexRef = useRef(-1);
  
  const isReady = projectStatus?.has_edit_plan;

  // Load edit plan
  useEffect(() => {
    if (isReady && !editPlan) {
      loadEditPlan();
    }
  }, [isReady]);

  // Load scene index
  useEffect(() => {
    if (isReady && !sceneIndex) {
      loadSceneIndex();
    }
  }, [isReady]);

  const loadEditPlan = async () => {
    try {
      const response = await fetch(`http://127.0.0.1:5000/projects/${projectName}/edit-plan`);
      const data = await response.json();
      if (data.success) {
        console.log('📋 Edit plan loaded:', data.plan.length, 'clips');
        setEditPlan(data.plan);
      }
    } catch (err) {
      console.error('Failed to load edit plan:', err);
    }
  };

  const loadSceneIndex = async () => {
    try {
      const response = await fetch(`http://127.0.0.1:5000/projects/${projectName}/scene-index`);
      const data = await response.json();
      if (data.success) {
        console.log('📑 Scene index loaded:', data.scenes.length, 'scenes');
        setSceneIndex(data.scenes);
      }
    } catch (err) {
      console.error('Failed to load scene index:', err);
    }
  };

  // Get current clip based on timeline position
  const getCurrentClip = (timelineTime) => {
    if (!editPlan) return null;
    
    for (let i = 0; i < editPlan.length; i++) {
      const clip = editPlan[i];
      if (timelineTime >= clip.start && timelineTime < clip.end) {
        return { clip, index: i };
      }
    }
    
    // If past the end, return last clip
    if (timelineTime >= editPlan[editPlan.length - 1].end) {
      return null;
    }
    
    return null;
  };

  // CRITICAL: Calculate video timecode from scene index
  const getVideoTimecode = (clip, timelineTime) => {
    if (!clip || !sceneIndex) return 0;
    
    const sceneId = clip.scene_id;
    if (sceneId === null || sceneId === undefined) return 0;
    
    // Find scene in index
    const scene = sceneIndex.find(s => s.id === sceneId);
    if (!scene) {
      console.warn(`⚠️ Scene ${sceneId} not found in index`);
      return 0;
    }
    
    // Calculate offset within THIS clip's timeline
    const clipOffset = timelineTime - clip.start;
    
    // MAGIC: Map to source video timecode
    const videoTime = scene.start_time + clipOffset;
    
    return videoTime;
  };

  // Main playback engine using requestAnimationFrame
  useEffect(() => {
    if (!isPlaying || !editPlan || !sceneIndex || !videoRef.current || !audioRef.current) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      return;
    }

    console.log('▶️ Starting NLE playback engine');
    
    let lastTime = performance.now();
    let accumulatedTime = currentTime;
    
    const tick = (now) => {
      const deltaTime = (now - lastTime) / 1000; // Convert to seconds
      lastTime = now;
      
      accumulatedTime += deltaTime;
      
      const totalDuration = editPlan[editPlan.length - 1]?.end || 0;
      
      // Check if finished
      if (accumulatedTime >= totalDuration) {
        console.log('⏹️ Playback finished');
        setIsPlaying(false);
        setCurrentTime(0);
        setCurrentClipIndex(0);
        lastClipIndexRef.current = -1;
        
        // Reset video and audio
        if (videoRef.current) videoRef.current.currentTime = 0;
        if (audioRef.current) audioRef.current.currentTime = 0;
        
        return;
      }
      
      setCurrentTime(accumulatedTime);
      
      // Find current clip
      const current = getCurrentClip(accumulatedTime);
      
      if (current) {
        // Detect clip change
        if (current.index !== lastClipIndexRef.current) {
          console.log(`🎬 CLIP CHANGE: ${lastClipIndexRef.current + 1} → ${current.index + 1}`);
          console.log(`   Scene: ${current.clip.scene_id}`);
          console.log(`   Phrase: "${current.clip.phrase}"`);
          
          setCurrentClipIndex(current.index);
          lastClipIndexRef.current = current.index;
          
          // CRITICAL: Jump video to new scene
          const newVideoTime = getVideoTimecode(current.clip, accumulatedTime);
          console.log(`   ⚡ Seeking video: ${newVideoTime.toFixed(2)}s`);
          
          if (videoRef.current) {
            videoRef.current.currentTime = newVideoTime;
          }
        } else {
          // Same clip - smooth video playback
          const targetVideoTime = getVideoTimecode(current.clip, accumulatedTime);
          
          if (videoRef.current) {
            const currentVideoTime = videoRef.current.currentTime;
            const drift = Math.abs(currentVideoTime - targetVideoTime);
            
            // Only seek if drift is significant (>0.3s)
            if (drift > 0.3) {
              console.log(`   🔧 Correcting drift: ${drift.toFixed(2)}s`);
              videoRef.current.currentTime = targetVideoTime;
            }
          }
        }
        
        // Sync audio to timeline
        if (audioRef.current) {
          const audioDrift = Math.abs(audioRef.current.currentTime - accumulatedTime);
          if (audioDrift > 0.2) {
            audioRef.current.currentTime = accumulatedTime;
          }
        }
      }
      
      animationFrameRef.current = requestAnimationFrame(tick);
    };
    
    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, editPlan, sceneIndex, currentTime]);

  // Play/Pause controls
  const togglePlay = async () => {
    if (!videoRef.current || !audioRef.current || !editPlan || !sceneIndex) return;
    
    if (!isPlaying) {
      try {
        // Sync before starting
        const current = getCurrentClip(currentTime);
        if (current) {
          const videoTime = getVideoTimecode(current.clip, currentTime);
          videoRef.current.currentTime = videoTime;
          audioRef.current.currentTime = currentTime;
          
          console.log(`▶️ Starting playback at timeline ${currentTime.toFixed(2)}s`);
          console.log(`   Video: ${videoTime.toFixed(2)}s (scene ${current.clip.scene_id})`);
        }
        
        await Promise.all([
          videoRef.current.play(),
          audioRef.current.play()
        ]);
        setIsPlaying(true);
      } catch (err) {
        console.error('Playback error:', err);
      }
    } else {
      videoRef.current.pause();
      audioRef.current.pause();
      setIsPlaying(false);
      console.log('⏸️ Playback paused');
    }
  };

  const skipForward = () => {
    const totalDuration = editPlan?.[editPlan.length - 1]?.end || 0;
    const newTime = Math.min(currentTime + 5, totalDuration);
    setCurrentTime(newTime);
    
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
    
    // Update video position
    const current = getCurrentClip(newTime);
    if (current && videoRef.current) {
      const videoTime = getVideoTimecode(current.clip, newTime);
      videoRef.current.currentTime = videoTime;
    }
  };

  const skipBackward = () => {
    const newTime = Math.max(currentTime - 5, 0);
    setCurrentTime(newTime);
    
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
    
    // Update video position
    const current = getCurrentClip(newTime);
    if (current && videoRef.current) {
      const videoTime = getVideoTimecode(current.clip, newTime);
      videoRef.current.currentTime = videoTime;
    }
  };

  const handleSeek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const totalDuration = editPlan?.[editPlan.length - 1]?.end || 0;
    const newTime = percentage * totalDuration;
    
    setCurrentTime(newTime);
    
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
    
    // Seek video to correct scene
    const current = getCurrentClip(newTime);
    if (current && videoRef.current) {
      const videoTime = getVideoTimecode(current.clip, newTime);
      videoRef.current.currentTime = videoTime;
      setCurrentClipIndex(current.index);
      lastClipIndexRef.current = current.index;
      
      console.log(`⏭️ Seeked to ${newTime.toFixed(2)}s (clip ${current.index + 1})`);
    }
  };

  const toggleMute = () => {
    if (audioRef.current) {
      audioRef.current.muted = !muted;
      setMuted(!muted);
    }
  };

  const handleVolumeChange = (e) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const totalDuration = editPlan?.[editPlan.length - 1]?.end || 0;
  const progressPercent = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;
  const currentClip = editPlan?.[currentClipIndex];

  return (
    <div className="bg-gray-800 p-6 rounded-lg sticky top-6">
      {/* Hidden audio player */}
      <audio 
        ref={audioRef}
        src={`http://127.0.0.1:5000/projects/${projectName}/voice.mp3`}
        preload="auto"
      />
      
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Preview</h3>
        {isReady && (
          <button 
            onClick={() => setShowPlayer(!showPlayer)}
            className="text-sm text-blue-400 hover:text-blue-300 transition flex items-center gap-1"
          >
            <Maximize2 className="w-4 h-4" />
            {showPlayer ? 'Hide' : 'Show'} Player
          </button>
        )}
      </div>

      {/* Video Player Area */}
      <div className="aspect-video bg-gray-900 rounded-lg mb-4 flex items-center justify-center relative overflow-hidden">
        {!isReady ? (
          <div className="text-center p-8">
            <Eye className="w-16 h-16 text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500 text-sm">
              Preview will appear here after processing
            </p>
          </div>
        ) : showPlayer ? (
          <div className="relative w-full h-full bg-black">
            {/* Video Element */}
            <video 
              ref={videoRef}
              src={`http://127.0.0.1:5000/projects/${projectName}/movie.mp4`}
              className="w-full h-full object-contain"
              muted
              preload="auto"
              onError={(e) => {
                console.error('Video load error:', e);
              }}
            />
            
            {/* Subtitle Overlay */}
            {currentClip && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/80 to-transparent p-6 pointer-events-none">
                <p className="text-white text-center drop-shadow-lg text-lg">
                  {currentClip.phrase}
                </p>
              </div>
            )}

            {/* Controls Overlay */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition bg-black bg-opacity-30">
              <button 
                onClick={togglePlay}
                className="p-4 bg-blue-600 hover:bg-blue-700 rounded-full transition"
              >
                {isPlaying ? (
                  <PauseCircle className="w-12 h-12 text-white" />
                ) : (
                  <PlayCircle className="w-12 h-12 text-white" />
                )}
              </button>
            </div>

            {/* Debug Info */}
            <div className="absolute top-2 right-2 bg-black bg-opacity-70 px-3 py-2 rounded text-xs text-white font-mono">
              <div>Clip: {currentClipIndex + 1}/{editPlan?.length || 0}</div>
              <div>Scene: {currentClip?.scene_id ?? 'N/A'}</div>
              <div>Timeline: {formatTime(currentTime)}</div>
              {currentClip && sceneIndex && (
                <div className="text-green-400">
                  Video: {formatTime(getVideoTimecode(currentClip, currentTime))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center">
            <PlayCircle 
              onClick={() => setShowPlayer(true)}
              className="w-20 h-20 text-blue-500 mx-auto mb-4 cursor-pointer hover:text-blue-400 transition" 
            />
            <p className="text-gray-400 text-sm">
              Click to open player
            </p>
          </div>
        )}

        {/* Progress Overlay */}
        {!isReady && progress > 0 && (
          <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-transparent to-transparent flex items-end justify-center p-6">
            <div className="w-full">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400">Processing</span>
                <span className="text-sm font-semibold text-white">{progress}%</span>
              </div>
              <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Player Controls */}
      {showPlayer && isReady && (
        <div className="space-y-3">
          {/* Timeline */}
          <div 
            className="h-2 bg-gray-700 rounded-full cursor-pointer group relative"
            onClick={handleSeek}
          >
            <div 
              className="h-full bg-blue-500 rounded-full transition group-hover:bg-blue-400"
              style={{ width: `${progressPercent}%` }}
            />
            {/* Scrubber */}
            <div 
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition"
              style={{ left: `${progressPercent}%`, transform: 'translate(-50%, -50%)' }}
            />
          </div>

          {/* Time Display */}
          <div className="flex items-center justify-between text-sm text-gray-400">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(totalDuration)}</span>
          </div>

          {/* Control Buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={skipBackward}
                className="p-2 hover:bg-gray-700 rounded transition"
              >
                <SkipBack className="w-5 h-5" />
              </button>
              
              <button
                onClick={togglePlay}
                disabled={!sceneIndex}
                className="p-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-full transition"
              >
                {isPlaying ? (
                  <PauseCircle className="w-6 h-6" />
                ) : (
                  <PlayCircle className="w-6 h-6" />
                )}
              </button>

              <button
                onClick={skipForward}
                className="p-2 hover:bg-gray-700 rounded transition"
              >
                <SkipForward className="w-5 h-5" />
              </button>
            </div>

            {/* Volume Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleMute}
                className="p-2 hover:bg-gray-700 rounded transition"
              >
                {muted ? (
                  <VolumeX className="w-5 h-5" />
                ) : (
                  <Volume2 className="w-5 h-5" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={volume}
                onChange={handleVolumeChange}
                className="w-20 h-1 bg-gray-700 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${volume * 100}%, #374151 ${volume * 100}%, #374151 100%)`
                }}
              />
            </div>
          </div>

          {/* Current Clip Info */}
          {currentClip && (
            <div className="text-xs text-gray-500 text-center">
              Scene {currentClip.scene_id} • Clip {currentClipIndex + 1} of {editPlan?.length}
            </div>
          )}
          
          {!sceneIndex && (
            <div className="text-xs text-yellow-500 text-center">
              ⚠️ Loading scene index...
            </div>
          )}
        </div>
      )}

      {/* Project Info */}
      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Project:</span>
          <span className="text-white font-medium">{projectName}</span>
        </div>
        
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Status:</span>
          <span className={`font-medium ${isReady ? 'text-green-400' : 'text-yellow-400'}`}>
            {isReady ? 'Ready to Export' : 'Processing...'}
          </span>
        </div>

        {projectStatus && (
          <>
            <div className="pt-3 border-t border-gray-700">
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                Pipeline Status
              </div>
              <div className="space-y-2">
                <StatusItem
                  label="Transcript"
                  completed={projectStatus.has_transcript}
                />
                <StatusItem
                  label="Video Indexed"
                  completed={projectStatus.has_frames && projectStatus.has_embeddings}
                />
                <StatusItem
                  label="Scenes Analyzed"
                  completed={projectStatus.has_characters}
                />
                <StatusItem
                  label="Edit Plan"
                  completed={projectStatus.has_edit_plan}
                />
              </div>
            </div>
          </>
        )}

        {/* Warning if files missing */}
        {projectStatus && (!projectStatus.has_video || !projectStatus.has_audio) && (
          <div className="flex items-start gap-2 p-3 bg-yellow-900 bg-opacity-20 border border-yellow-800 rounded-lg">
            <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-yellow-300">
              {!projectStatus.has_video && <div>Missing: movie.mp4</div>}
              {!projectStatus.has_audio && <div>Missing: voice.mp3</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusItem({ label, completed }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400 text-xs">{label}</span>
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${completed ? 'bg-green-500' : 'bg-gray-600'}`} />
        <span className={`text-xs ${completed ? 'text-green-400' : 'text-gray-500'}`}>
          {completed ? 'Done' : 'Pending'}
        </span>
      </div>
    </div>
  );
}
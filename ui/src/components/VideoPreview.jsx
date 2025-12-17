import React, { useState, useEffect, useRef } from 'react';
import { Eye, PlayCircle, PauseCircle, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';

export default function VideoPreview({ projectName, projectStatus, progress }) {
  const [showPlayer, setShowPlayer] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [clips, setClips] = useState([]);
  const [sceneMap, setSceneMap] = useState({});
  const [currentClipIndex, setCurrentClipIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  
  // Media refs
  const audioRef = useRef(null);
  const playerARef = useRef(null);
  const playerBRef = useRef(null);
  const rafRef = useRef(null);
  
  // Player state
  const activePlayerRef = useRef('A'); // 'A' or 'B'
  const preloadedClipIndexRef = useRef(-1);
  
  const isReady = projectStatus?.has_edit_plan;

  // ============================================================================
  // STEP 1: Parse XML data on mount
  // ============================================================================
  useEffect(() => {
    if (!isReady) return;
    
    const loadXMLData = async () => {
      try {
        // Fetch XML files
        const [editResponse, indexResponse] = await Promise.all([
          fetch(`http://127.0.0.1:5000/projects/${projectName}/edit-plan-xml`),
          fetch(`http://127.0.0.1:5000/projects/${projectName}/scene-index-xml`)
        ]);
        
        // For now, we'll use JSON endpoints since XML endpoints don't exist yet
        // TODO: Backend should expose XML endpoints or we parse from JSON
        const [editData, indexData] = await Promise.all([
          fetch(`http://127.0.0.1:5000/projects/${projectName}/edit-plan`).then(r => r.json()),
          fetch(`http://127.0.0.1:5000/projects/${projectName}/scene-index`).then(r => r.json())
        ]);
        
        if (editData.success && indexData.success) {
          // Parse clips from edit plan
          const parsedClips = editData.plan.map((clip, index) => ({
            index,
            start: clip.start,
            end: clip.end,
            duration: clip.duration,
            phrase: clip.phrase,
            sceneId: clip.scene_id
          }));
          
          // Create scene map: sceneId -> { videoIndex, startTime, videoUrl }
          const parsedSceneMap = {};
          indexData.scenes.forEach(scene => {
            parsedSceneMap[scene.id] = {
              videoIndex: scene.video_index || 0,
              startTime: scene.start_time,
              videoUrl: `http://127.0.0.1:5000/projects/${projectName}/video/${scene.video_index || 0}`
            };
          });
          
          setClips(parsedClips);
          setSceneMap(parsedSceneMap);
          
          console.log(`✅ Loaded ${parsedClips.length} clips and ${Object.keys(parsedSceneMap).length} scenes`);
        }
      } catch (err) {
        console.error('Failed to load XML data:', err);
      }
    };
    
    loadXMLData();
  }, [isReady, projectName]);

  // ============================================================================
  // STEP 2: Double Buffer Preloading System
  // ============================================================================
  
  const getActivePlayer = () => {
    return activePlayerRef.current === 'A' ? playerARef.current : playerBRef.current;
  };
  
  const getInactivePlayer = () => {
    return activePlayerRef.current === 'A' ? playerBRef.current : playerARef.current;
  };
  
  const switchPlayers = () => {
    activePlayerRef.current = activePlayerRef.current === 'A' ? 'B' : 'A';
  };
  
  /**
   * Preload the next clip into the inactive player
   */
  const preloadNextClip = (nextClipIndex) => {
    if (nextClipIndex >= clips.length || nextClipIndex < 0) return;
    if (preloadedClipIndexRef.current === nextClipIndex) return; // Already preloaded
    
    const nextClip = clips[nextClipIndex];
    const scene = sceneMap[nextClip.sceneId];
    
    if (!scene) return;
    
    const inactivePlayer = getInactivePlayer();
    if (!inactivePlayer) return;
    
    // Calculate video timecode for this clip
    const clipOffset = 0; // Clip always starts at its beginning for preload
    const videoTime = scene.startTime + clipOffset;
    
    // Set source and seek
    inactivePlayer.src = scene.videoUrl;
    inactivePlayer.currentTime = videoTime;
    inactivePlayer.load();
    
    preloadedClipIndexRef.current = nextClipIndex;
    
    console.log(`🔄 Preloaded clip ${nextClipIndex} into Player ${activePlayerRef.current === 'A' ? 'B' : 'A'}`);
  };
  
  /**
   * Switch to a specific clip (gapless transition)
   */
  const switchToClip = (clipIndex) => {
    if (clipIndex >= clips.length || clipIndex < 0) return;
    
    const clip = clips[clipIndex];
    const scene = sceneMap[clip.sceneId];
    
    if (!scene) return;
    
    const activePlayer = getActivePlayer();
    const inactivePlayer = getInactivePlayer();
    
    // If next clip is already preloaded in inactive player, just switch
    if (preloadedClipIndexRef.current === clipIndex) {
      // Pause current player
      if (activePlayer) activePlayer.pause();
      
      // Switch active player
      switchPlayers();
      
      // Play new active player
      const newActivePlayer = getActivePlayer();
      if (newActivePlayer && isPlaying) {
        newActivePlayer.play().catch(() => {});
      }
      
      console.log(`✂️ Switched to clip ${clipIndex} (Player ${activePlayerRef.current})`);
    } else {
      // Fallback: load directly into active player (will cause brief black frame)
      const clipOffset = currentTime - clip.start;
      const videoTime = scene.startTime + clipOffset;
      
      if (activePlayer) {
        activePlayer.src = scene.videoUrl;
        activePlayer.currentTime = videoTime;
        if (isPlaying) {
          activePlayer.play().catch(() => {});
        }
      }
      
      console.warn(`⚠️ Clip ${clipIndex} not preloaded, loading directly`);
    }
    
    setCurrentClipIndex(clipIndex);
    
    // Preload NEXT clip
    preloadNextClip(clipIndex + 1);
  };

  // ============================================================================
  // STEP 3: Main Playback Engine (RAF loop)
  // ============================================================================
  useEffect(() => {
    if (!isPlaying || clips.length === 0 || !audioRef.current) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    let lastUpdate = performance.now();

    const tick = (now) => {
      const delta = (now - lastUpdate) / 1000;
      lastUpdate = now;

      // Get timeline position from audio (master clock)
      const timelineTime = audioRef.current.currentTime;
      setCurrentTime(timelineTime);

      // Find current clip
      const clipIndex = clips.findIndex(c => timelineTime >= c.start && timelineTime < c.end);
      
      if (clipIndex === -1) {
        // End of timeline
        const totalDuration = clips[clips.length - 1]?.end || 0;
        if (timelineTime >= totalDuration) {
          setIsPlaying(false);
          setCurrentTime(0);
          audioRef.current.currentTime = 0;
          setCurrentClipIndex(0);
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // Check if we need to switch clips
      if (clipIndex !== currentClipIndex) {
        switchToClip(clipIndex);
      }

      // Sync active player to timeline
      const activePlayer = getActivePlayer();
      if (activePlayer && clips[clipIndex]) {
        const clip = clips[clipIndex];
        const scene = sceneMap[clip.sceneId];
        
        if (scene) {
          const clipOffset = timelineTime - clip.start;
          const targetVideoTime = scene.startTime + clipOffset;
          const drift = Math.abs(activePlayer.currentTime - targetVideoTime);
          
          // Correct drift > 0.1s
          if (drift > 0.1) {
            activePlayer.currentTime = targetVideoTime;
            console.log(`🔧 Corrected drift: ${drift.toFixed(3)}s`);
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, clips, sceneMap, currentClipIndex, currentTime]);

  // ============================================================================
  // Playback Controls
  // ============================================================================
  const togglePlay = async () => {
    if (!audioRef.current || clips.length === 0) return;
    
    if (!isPlaying) {
      try {
        // Start playback
        await audioRef.current.play();
        
        const activePlayer = getActivePlayer();
        if (activePlayer) {
          await activePlayer.play();
        }
        
        // Preload next clip
        preloadNextClip(currentClipIndex + 1);
        
        setIsPlaying(true);
      } catch (err) {
        console.error('Play error:', err);
      }
    } else {
      // Pause
      audioRef.current.pause();
      
      const activePlayer = getActivePlayer();
      if (activePlayer) activePlayer.pause();
      
      setIsPlaying(false);
    }
  };

  const skipForward = () => {
    if (!audioRef.current || clips.length === 0) return;
    const totalDuration = clips[clips.length - 1]?.end || 0;
    const newTime = Math.min(currentTime + 5, totalDuration);
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const skipBackward = () => {
    if (!audioRef.current) return;
    const newTime = Math.max(currentTime - 5, 0);
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleSeek = (e) => {
    if (!audioRef.current || clips.length === 0) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const totalDuration = clips[clips.length - 1]?.end || 0;
    const newTime = percentage * totalDuration;
    
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const toggleMute = () => {
    if (audioRef.current) {
      audioRef.current.muted = !muted;
      setMuted(!muted);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // ============================================================================
  // Render
  // ============================================================================
  const totalDuration = clips[clips.length - 1]?.end || 0;
  const progressPercent = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;
  const currentClip = clips[currentClipIndex];

  return (
    <div className="bg-gray-800 p-6 rounded-lg sticky top-6">
      {/* Hidden audio track */}
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
            className="text-sm text-blue-400 hover:text-blue-300 transition"
          >
            {showPlayer ? 'Hide' : 'Show'} Player
          </button>
        )}
      </div>

      {/* Video Player Container */}
      <div className="aspect-video bg-gray-900 rounded-lg mb-4 flex items-center justify-center relative overflow-hidden">
        {!isReady ? (
          <div className="text-center p-8">
            <Eye className="w-16 h-16 text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500 text-sm">Preview will appear after processing</p>
          </div>
        ) : showPlayer ? (
          <div className="relative w-full h-full bg-black">
            {/* Double Buffer: Player A */}
            <video
              ref={playerARef}
              className="absolute inset-0 w-full h-full object-contain transition-opacity duration-100"
              style={{ opacity: activePlayerRef.current === 'A' ? 1 : 0 }}
              muted
              preload="auto"
            />
            
            {/* Double Buffer: Player B */}
            <video
              ref={playerBRef}
              className="absolute inset-0 w-full h-full object-contain transition-opacity duration-100"
              style={{ opacity: activePlayerRef.current === 'B' ? 1 : 0 }}
              muted
              preload="auto"
            />
            
            {/* Subtitle overlay */}
            {currentClip && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/80 to-transparent p-6 pointer-events-none z-10">
                <p className="text-white text-center drop-shadow-lg text-lg">
                  {currentClip.phrase}
                </p>
              </div>
            )}

            {/* Play button overlay */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition bg-black bg-opacity-30 z-20">
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

            {/* Debug info */}
            <div className="absolute top-2 right-2 bg-black bg-opacity-70 px-3 py-2 rounded text-xs text-white font-mono z-10">
              <div>Clip: {currentClipIndex + 1}/{clips.length}</div>
              <div>Scene: {currentClip?.sceneId ?? 'N/A'}</div>
              <div>Player: {activePlayerRef.current}</div>
              <div>Time: {formatTime(currentTime)}</div>
            </div>
          </div>
        ) : (
          <div className="text-center">
            <PlayCircle 
              onClick={() => setShowPlayer(true)}
              className="w-20 h-20 text-blue-500 mx-auto mb-4 cursor-pointer hover:text-blue-400 transition" 
            />
            <p className="text-gray-400 text-sm">Click to open player</p>
          </div>
        )}

        {/* Processing progress overlay */}
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
      {showPlayer && isReady && clips.length > 0 && (
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
            <div 
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition"
              style={{ left: `${progressPercent}%`, transform: 'translate(-50%, -50%)' }}
            />
          </div>

          {/* Time display */}
          <div className="flex items-center justify-between text-sm text-gray-400">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(totalDuration)}</span>
          </div>

          {/* Control buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={skipBackward} className="p-2 hover:bg-gray-700 rounded transition">
                <SkipBack className="w-5 h-5" />
              </button>
              
              <button
                onClick={togglePlay}
                className="p-3 bg-blue-600 hover:bg-blue-700 rounded-full transition"
              >
                {isPlaying ? <PauseCircle className="w-6 h-6" /> : <PlayCircle className="w-6 h-6" />}
              </button>

              <button onClick={skipForward} className="p-2 hover:bg-gray-700 rounded transition">
                <SkipForward className="w-5 h-5" />
              </button>
            </div>

            {/* Volume control */}
            <button onClick={toggleMute} className="p-2 hover:bg-gray-700 rounded transition">
              {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
          </div>
        </div>
      )}

      {/* Project Status */}
      <div className="space-y-3 text-sm mt-4">
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Project:</span>
          <span className="text-white font-medium">{projectName}</span>
        </div>
        
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Status:</span>
          <span className={`font-medium ${isReady ? 'text-green-400' : 'text-yellow-400'}`}>
            {isReady ? 'Ready' : 'Processing...'}
          </span>
        </div>

        {projectStatus && isReady && (
          <div className="pt-3 border-t border-gray-700">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Pipeline</div>
            <div className="space-y-2">
              <StatusItem label="Transcript" completed={projectStatus.has_transcript} />
              <StatusItem label="Video Indexed" completed={projectStatus.has_frames} />
              <StatusItem label="Scenes Analyzed" completed={projectStatus.has_characters} />
              <StatusItem label="Edit Plan" completed={projectStatus.has_edit_plan} />
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

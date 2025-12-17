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
  const [loadError, setLoadError] = useState(null);
  
  // Media refs
  const audioRef = useRef(null);
  const playerARef = useRef(null);
  const playerBRef = useRef(null);
  const rafRef = useRef(null);
  
  // Player state
  const activePlayerRef = useRef('A');
  const preloadedClipIndexRef = useRef(-1);
  
  const isReady = projectStatus?.has_edit_plan;

  // ============================================================================
  // STEP 1: Parse data on mount
  // ============================================================================
  useEffect(() => {
    if (!isReady) return;
    
    const loadData = async () => {
      try {
        setLoadError(null);
        
        console.log('🔄 Loading edit plan and scene index...');
        
        // Fetch JSON data
        const [editResponse, indexResponse] = await Promise.all([
          fetch(`http://127.0.0.1:5000/projects/${projectName}/edit-plan`),
          fetch(`http://127.0.0.1:5000/projects/${projectName}/scene-index`)
        ]);
        
        if (!editResponse.ok || !indexResponse.ok) {
          throw new Error('Failed to fetch project data');
        }
        
        const [editData, indexData] = await Promise.all([
          editResponse.json(),
          indexResponse.json()
        ]);
        
        console.log('📊 Edit plan:', editData);
        console.log('📊 Scene index:', indexData);
        
        if (!editData.success || !indexData.success) {
          throw new Error('Invalid response from server');
        }
        
        // Parse clips from edit plan
        const parsedClips = editData.plan
          .filter(clip => clip.scene_id !== null) // Skip clips without scenes
          .map((clip, index) => ({
            index,
            start: clip.start,
            end: clip.end,
            duration: clip.duration,
            phrase: clip.phrase,
            sceneId: clip.scene_id
          }));
        
        if (parsedClips.length === 0) {
          throw new Error('No valid clips found in edit plan');
        }
        
        // Create scene map: sceneId -> { videoIndex, startTime, endTime, videoUrl }
        const parsedSceneMap = {};
        
        indexData.scenes.forEach(scene => {
          const videoIndex = scene.video_index ?? 0;
          
          parsedSceneMap[scene.id] = {
            videoIndex: videoIndex,
            startTime: scene.start_time,
            endTime: scene.end_time,
            duration: scene.duration,
            // ✅ FIX: Правильный формат URL для эндпоинта
            videoUrl: `http://127.0.0.1:5000/projects/${encodeURIComponent(projectName)}/video/${videoIndex}`
          };
        });
        
        console.log('✅ Parsed clips:', parsedClips.length);
        console.log('✅ Parsed scenes:', Object.keys(parsedSceneMap).length);
        console.log('📹 Sample scene:', parsedSceneMap[parsedClips[0]?.sceneId]);
        
        setClips(parsedClips);
        setSceneMap(parsedSceneMap);
        
        // Preload first clip
        if (parsedClips.length > 0) {
          setTimeout(() => {
            preloadClip(0);
          }, 500);
        }
        
      } catch (err) {
        console.error('❌ Failed to load data:', err);
        setLoadError(err.message);
      }
    };
    
    loadData();
  }, [isReady, projectName]);

  // ============================================================================
  // STEP 2: Double Buffer Preloading
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
   * Preload a specific clip into a player
   */
  const preloadClip = (clipIndex, targetPlayer = null) => {
    if (clipIndex < 0 || clipIndex >= clips.length) {
      console.warn(`⚠️ Invalid clip index: ${clipIndex}`);
      return;
    }
    
    const clip = clips[clipIndex];
    const scene = sceneMap[clip.sceneId];
    
    if (!scene) {
      console.error(`❌ Scene not found for clip ${clipIndex}, sceneId: ${clip.sceneId}`);
      return;
    }
    
    const player = targetPlayer || getInactivePlayer();
    
    if (!player) {
      console.error('❌ No player available for preload');
      return;
    }
    
    // Set video source
    const videoUrl = scene.videoUrl;
    
    console.log(`🔄 Preloading clip ${clipIndex} into Player ${targetPlayer ? 'specified' : (activePlayerRef.current === 'A' ? 'B' : 'A')}`);
    console.log(`   Scene ${scene.videoIndex}, start: ${scene.startTime}s, URL: ${videoUrl}`);
    
    // ✅ FIX: Set source and initial time
    if (player.src !== videoUrl) {
      player.src = videoUrl;
    }
    
    // Seek to scene start
    player.currentTime = scene.startTime;
    
    // Ensure loaded
    player.load();
    
    // Mark as preloaded
    if (!targetPlayer) {
      preloadedClipIndexRef.current = clipIndex;
    }
    
    // Add error handler
    player.onerror = (e) => {
      console.error(`❌ Video load error for clip ${clipIndex}:`, e);
      console.error('   URL:', videoUrl);
      console.error('   Error code:', player.error?.code);
      console.error('   Error message:', player.error?.message);
    };
    
    // Success handler
    player.onloadedmetadata = () => {
      console.log(`✅ Video metadata loaded for clip ${clipIndex}`);
      console.log(`   Duration: ${player.duration}s, seekable: ${player.seekable.length > 0}`);
    };
  };
  
  /**
   * Switch to a specific clip (gapless transition)
   */
  const switchToClip = (clipIndex) => {
    if (clipIndex < 0 || clipIndex >= clips.length) return;
    
    const clip = clips[clipIndex];
    const scene = sceneMap[clip.sceneId];
    
    if (!scene) {
      console.error(`❌ Scene not found for clip ${clipIndex}`);
      return;
    }
    
    console.log(`✂️ Switching to clip ${clipIndex} (scene ${clip.sceneId})`);
    
    const activePlayer = getActivePlayer();
    
    // If next clip is preloaded in inactive player, switch
    if (preloadedClipIndexRef.current === clipIndex) {
      // Pause current
      if (activePlayer) activePlayer.pause();
      
      // Switch active player
      switchPlayers();
      
      // Play new active
      const newActivePlayer = getActivePlayer();
      if (newActivePlayer && isPlaying) {
        newActivePlayer.play().catch(err => {
          console.error('❌ Play error:', err);
        });
      }
      
      console.log(`✅ Switched to preloaded clip (Player ${activePlayerRef.current})`);
    } else {
      // Fallback: load directly
      console.warn(`⚠️ Clip ${clipIndex} not preloaded, loading directly`);
      
      if (activePlayer) {
        const clipOffset = Math.max(0, currentTime - clip.start);
        const videoTime = scene.startTime + clipOffset;
        
        activePlayer.src = scene.videoUrl;
        activePlayer.currentTime = videoTime;
        
        if (isPlaying) {
          activePlayer.play().catch(err => {
            console.error('❌ Play error:', err);
          });
        }
      }
    }
    
    setCurrentClipIndex(clipIndex);
    
    // Preload NEXT clip
    if (clipIndex + 1 < clips.length) {
      preloadClip(clipIndex + 1);
    }
  };

  // ============================================================================
  // STEP 3: Main Playback Engine
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

      // Get timeline position from audio
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

      // Switch clips if needed
      if (clipIndex !== currentClipIndex) {
        switchToClip(clipIndex);
      }

      // Sync active player
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
        // Preload first clip if not already
        if (currentClipIndex === 0 && preloadedClipIndexRef.current !== 0) {
          preloadClip(0, getActivePlayer());
          await new Promise(resolve => setTimeout(resolve, 500)); // Wait for load
        }
        
        // Start playback
        await audioRef.current.play();
        
        const activePlayer = getActivePlayer();
        if (activePlayer) {
          await activePlayer.play();
        }
        
        // Preload next
        if (currentClipIndex + 1 < clips.length) {
          preloadClip(currentClipIndex + 1);
        }
        
        setIsPlaying(true);
      } catch (err) {
        console.error('❌ Play error:', err);
        setLoadError(`Playback error: ${err.message}`);
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
        src={`http://127.0.0.1:5000/projects/${encodeURIComponent(projectName)}/voice.mp3`}
        preload="auto"
        onError={(e) => {
          console.error('❌ Audio load error:', e);
          setLoadError('Failed to load audio');
        }}
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

      {/* Error Display */}
      {loadError && (
        <div className="mb-4 p-3 bg-red-900/20 border border-red-800 rounded text-red-400 text-sm">
          ⚠️ {loadError}
        </div>
      )}

      {/* Video Player Container */}
      <div className="aspect-video bg-gray-900 rounded-lg mb-4 flex items-center justify-center relative overflow-hidden">
        {!isReady ? (
          <div className="text-center p-8">
            <Eye className="w-16 h-16 text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500 text-sm">Preview will appear after processing</p>
          </div>
        ) : showPlayer ? (
          <div className="relative w-full h-full bg-black">
            {/* Player A */}
            <video
              ref={playerARef}
              className="absolute inset-0 w-full h-full object-contain transition-opacity duration-100"
              style={{ opacity: activePlayerRef.current === 'A' ? 1 : 0 }}
              muted
              preload="auto"
            />
            
            {/* Player B */}
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

            {/* Play overlay */}
            {!isPlaying && (
              <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 z-20">
                <button 
                  onClick={togglePlay}
                  className="p-4 bg-blue-600 hover:bg-blue-700 rounded-full transition"
                >
                  <PlayCircle className="w-12 h-12 text-white" />
                </button>
              </div>
            )}

            {/* Debug info */}
            <div className="absolute top-2 right-2 bg-black bg-opacity-70 px-3 py-2 rounded text-xs text-white font-mono z-10">
              <div>Clip: {currentClipIndex + 1}/{clips.length}</div>
              <div>Scene: {currentClip?.sceneId ?? 'N/A'}</div>
              <div>Player: {activePlayerRef.current}</div>
              <div>Time: {formatTime(currentTime)}</div>
              {currentClip && sceneMap[currentClip.sceneId] && (
                <div>Video: {sceneMap[currentClip.sceneId].videoIndex}</div>
              )}
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
          </div>

          {/* Time */}
          <div className="flex items-center justify-between text-sm text-gray-400">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(totalDuration)}</span>
          </div>

          {/* Controls */}
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

            <button onClick={toggleMute} className="p-2 hover:bg-gray-700 rounded transition">
              {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
          </div>
        </div>
      )}

      {/* Project Status */}
      <div className="space-y-3 text-sm mt-4">
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Clips loaded:</span>
          <span className="text-white font-medium">{clips.length}</span>
        </div>
        
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Scenes mapped:</span>
          <span className="text-white font-medium">{Object.keys(sceneMap).length}</span>
        </div>
      </div>
    </div>
  );
}

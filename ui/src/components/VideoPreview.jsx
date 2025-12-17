import React, { useState, useEffect, useRef } from 'react';
import { Eye, PlayCircle, PauseCircle, Maximize2, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';

export default function VideoPreview({ projectName, projectStatus, progress }) {
  const [showPlayer, setShowPlayer] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [editPlan, setEditPlan] = useState(null);
  const [sceneIndex, setSceneIndex] = useState(null);
  const [videoList, setVideoList] = useState([]);
  const [currentClipIndex, setCurrentClipIndex] = useState(0);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  
  const videoRefs = useRef({});  // Multiple video elements
  const audioRef = useRef(null);
  const animationFrameRef = useRef(null);
  const lastClipIndexRef = useRef(-1);
  
  const isReady = projectStatus?.has_edit_plan;

  // Load project videos
  useEffect(() => {
    if (isReady && videoList.length === 0) {
      loadVideoList();
    }
  }, [isReady]);

  // Load edit plan and scene index
  useEffect(() => {
    if (isReady && !editPlan) {
      loadEditPlan();
    }
  }, [isReady]);

  useEffect(() => {
    if (isReady && !sceneIndex) {
      loadSceneIndex();
    }
  }, [isReady]);

  const loadVideoList = async () => {
    try {
      const response = await fetch(`http://127.0.0.1:5000/projects/${projectName}/videos`);
      const data = await response.json();
      if (data.success) {
        console.log('📹 Video list loaded:', data.videos.length, 'videos');
        setVideoList(data.videos);
      }
    } catch (err) {
      console.error('Failed to load video list:', err);
    }
  };

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

  const getCurrentClip = (timelineTime) => {
    if (!editPlan) return null;
    
    for (let i = 0; i < editPlan.length; i++) {
      const clip = editPlan[i];
      if (timelineTime >= clip.start && timelineTime < clip.end) {
        return { clip, index: i };
      }
    }
    
    if (timelineTime >= editPlan[editPlan.length - 1].end) {
      return null;
    }
    
    return null;
  };

  const getVideoTimecode = (clip, timelineTime) => {
    if (!clip || !sceneIndex) return { videoIndex: 0, time: 0 };
    
    const sceneId = clip.scene_id;
    if (sceneId === null || sceneId === undefined) {
      return { videoIndex: 0, time: 0 };
    }
    
    const scene = sceneIndex.find(s => s.id === sceneId);
    if (!scene) {
      console.warn(`⚠️ Scene ${sceneId} not found in index`);
      return { videoIndex: 0, time: 0 };
    }
    
    const clipOffset = timelineTime - clip.start;
    const videoTime = scene.start_time + clipOffset;
    
    return {
      videoIndex: scene.video_index,  // NEW: which video
      time: videoTime
    };
  };

  // Main playback engine
  useEffect(() => {
    if (!isPlaying || !editPlan || !sceneIndex || !audioRef.current || videoList.length === 0) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      return;
    }

    console.log('▶️ Starting multi-video NLE playback engine');
    
    let lastTime = performance.now();
    let accumulatedTime = currentTime;
    
    const tick = (now) => {
      const deltaTime = (now - lastTime) / 1000;
      lastTime = now;
      
      accumulatedTime += deltaTime;
      
      const totalDuration = editPlan[editPlan.length - 1]?.end || 0;
      
      if (accumulatedTime >= totalDuration) {
        console.log('⏹️ Playback finished');
        setIsPlaying(false);
        setCurrentTime(0);
        setCurrentClipIndex(0);
        setCurrentVideoIndex(0);
        lastClipIndexRef.current = -1;
        
        // Reset all videos
        Object.values(videoRefs.current).forEach(video => {
          if (video) video.currentTime = 0;
        });
        
        if (audioRef.current) audioRef.current.currentTime = 0;
        
        return;
      }
      
      setCurrentTime(accumulatedTime);
      
      const current = getCurrentClip(accumulatedTime);
      
      if (current) {
        if (current.index !== lastClipIndexRef.current) {
          console.log(`🎬 CLIP CHANGE: ${lastClipIndexRef.current + 1} → ${current.index + 1}`);
          
          setCurrentClipIndex(current.index);
          lastClipIndexRef.current = current.index;
          
          const { videoIndex, time } = getVideoTimecode(current.clip, accumulatedTime);
          console.log(`   Scene: ${current.clip.scene_id} from Video ${videoIndex}`);
          console.log(`   ⚡ Seeking to ${time.toFixed(2)}s`);
          
          // Switch to correct video
          if (videoIndex !== currentVideoIndex) {
            console.log(`   🔄 Switching from Video ${currentVideoIndex} → Video ${videoIndex}`);
            setCurrentVideoIndex(videoIndex);
          }
          
          const videoEl = videoRefs.current[videoIndex];
          if (videoEl) {
            videoEl.currentTime = time;
          }
        } else {
          // Same clip - smooth playback
          const { videoIndex, time: targetVideoTime } = getVideoTimecode(current.clip, accumulatedTime);
          const videoEl = videoRefs.current[videoIndex];
          
          if (videoEl) {
            const currentVideoTime = videoEl.currentTime;
            const drift = Math.abs(currentVideoTime - targetVideoTime);
            
            if (drift > 0.3) {
              console.log(`   🔧 Correcting drift: ${drift.toFixed(2)}s`);
              videoEl.currentTime = targetVideoTime;
            }
          }
        }
        
        // Sync audio
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
  }, [isPlaying, editPlan, sceneIndex, currentTime, videoList]);

  const togglePlay = async () => {
    if (!audioRef.current || !editPlan || !sceneIndex || videoList.length === 0) return;
    
    if (!isPlaying) {
      try {
        const current = getCurrentClip(currentTime);
        if (current) {
          const { videoIndex, time } = getVideoTimecode(current.clip, currentTime);
          
          const videoEl = videoRefs.current[videoIndex];
          if (videoEl) {
            videoEl.currentTime = time;
            await videoEl.play();
          }
          
          audioRef.current.currentTime = currentTime;
          await audioRef.current.play();
          
          setCurrentVideoIndex(videoIndex);
          setIsPlaying(true);
          
          console.log(`▶️ Starting playback from Video ${videoIndex} at ${time.toFixed(2)}s`);
        }
      } catch (err) {
        console.error('Playback error:', err);
      }
    } else {
      Object.values(videoRefs.current).forEach(video => {
        if (video) video.pause();
      });
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
    
    const current = getCurrentClip(newTime);
    if (current) {
      const { videoIndex, time } = getVideoTimecode(current.clip, newTime);
      const videoEl = videoRefs.current[videoIndex];
      if (videoEl) {
        videoEl.currentTime = time;
        setCurrentVideoIndex(videoIndex);
      }
    }
  };

  const skipBackward = () => {
    const newTime = Math.max(currentTime - 5, 0);
    setCurrentTime(newTime);
    
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
    
    const current = getCurrentClip(newTime);
    if (current) {
      const { videoIndex, time } = getVideoTimecode(current.clip, newTime);
      const videoEl = videoRefs.current[videoIndex];
      if (videoEl) {
        videoEl.currentTime = time;
        setCurrentVideoIndex(videoIndex);
      }
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
    
    const current = getCurrentClip(newTime);
    if (current) {
      const { videoIndex, time } = getVideoTimecode(current.clip, newTime);
      const videoEl = videoRefs.current[videoIndex];
      if (videoEl) {
        videoEl.currentTime = time;
        setCurrentVideoIndex(videoIndex);
        setCurrentClipIndex(current.index);
        lastClipIndexRef.current = current.index;
      }
      
      console.log(`⏭️ Seeked to ${newTime.toFixed(2)}s (Video ${videoIndex}, clip ${current.index + 1})`);
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
      
      {/* Hidden video elements for each video */}
      {videoList.map(video => (
        <video
          key={video.index}
          ref={el => videoRefs.current[video.index] = el}
          src={`http://127.0.0.1:5000/projects/${projectName}/video/${video.index}`}
          preload="auto"
          muted
          style={{ display: 'none' }}
        />
      ))}
      
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
            {/* Active Video Display */}
            {videoList.map(video => (
              <video
                key={`display-${video.index}`}
                ref={el => {
                  if (el && !videoRefs.current[video.index]) {
                    videoRefs.current[video.index] = el;
                  }
                }}
                src={`http://127.0.0.1:5000/projects/${projectName}/video/${video.index}`}
                className={`w-full h-full object-contain ${video.index === currentVideoIndex ? 'block' : 'hidden'}`}
                muted
                preload="auto"
              />
            ))}
            
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
              <div>Video: {currentVideoIndex + 1}/{videoList.length}</div>
              <div>Timeline: {formatTime(currentTime)}</div>
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
            <p className="text-gray-500 text-xs mt-2">
              {videoList.length} video{videoList.length !== 1 ? 's' : ''} indexed
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
                disabled={!sceneIndex || videoList.length === 0}
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
              Scene {currentClip.scene_id} • Video {currentVideoIndex + 1} • Clip {currentClipIndex + 1}/{editPlan?.length}
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
        
        {videoList.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Videos:</span>
            <span className="text-white font-medium">{videoList.length}</span>
          </div>
        )}
        
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
                <StatusItem label="Transcript" completed={projectStatus.has_transcript} />
                <StatusItem label="Video Indexed" completed={projectStatus.has_frames && projectStatus.has_embeddings} />
                <StatusItem label="Scenes Analyzed" completed={projectStatus.has_characters} />
                <StatusItem label="Edit Plan" completed={projectStatus.has_edit_plan} />
              </div>
            </div>
          </>
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

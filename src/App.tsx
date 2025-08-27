import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Play, Pause, RotateCcw, AlertTriangle, Volume2, BarChart3, Terminal, Code, Cpu, Activity, Save, Download, Trash2, Clock, Upload, User, Users } from 'lucide-react';

interface AnalysisData {
  transcription: string;
  offensiveWords: string[];
  wordCount: number;
  duration: number;
  averageVolume: number;
  frequencyData: number[];
  audioBlob?: Blob;
  timestamp: number;
  id: string;
  genderDetection: {
    gender: 'male' | 'female' | 'unknown';
    confidence: number;
    fundamentalFreq: number;
  };
  source: 'recording' | 'upload';
  fileName?: string;
}

interface SavedSession {
  id: string;
  name: string;
  timestamp: number;
  data: AnalysisData;
}

const OFFENSIVE_WORDS = [
  'idiota', 'estúpido', 'tonto', 'imbécil', 'pendejo', 'cabrón', 'maldito', 'joder',
  'mierda', 'carajo', 'damn', 'shit', 'fuck', 'stupid', 'idiot', 'asshole',
  'bastard', 'bitch', 'hell', 'crap'
];

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [recordingTime, setRecordingTime] = useState(0);
  const [currentTranscription, setCurrentTranscription] = useState('');
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackFrequencies, setPlaybackFrequencies] = useState<number[]>([]);
  const [saveStatus, setSaveStatus] = useState<string>('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  // TypeScript does not have a built-in SpeechRecognition type, so we declare it here
  type SpeechRecognitionType = typeof window.SpeechRecognition | typeof window.webkitSpeechRecognition;
  const recognitionRef = useRef<InstanceType<SpeechRecognitionType> | null>(null);
  const intervalRef = useRef<number | null>(null);
  const animationRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playbackCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackAnalyserRef = useRef<AnalyserNode | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Load saved sessions from localStorage
    try {
      const saved = localStorage.getItem('voiceAnalyzerSessions');
      if (saved) {
        const sessions = JSON.parse(saved);
        setSavedSessions(sessions);
      }
    } catch (error) {
      console.error('Error loading sessions:', error);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      stopRecording();
    };
  }, []);

  const detectGender = (audioBuffer: AudioBuffer): { gender: 'male' | 'female' | 'unknown', confidence: number, fundamentalFreq: number } => {
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    
    // Simple pitch detection using autocorrelation
    const bufferSize = Math.min(4096, channelData.length);
    const autocorrelation = new Array(bufferSize).fill(0);
    
    // Calculate autocorrelation
    for (let lag = 0; lag < bufferSize; lag++) {
      for (let i = 0; i < bufferSize - lag; i++) {
        autocorrelation[lag] += channelData[i] * channelData[i + lag];
      }
    }
    
    // Find the peak (fundamental frequency)
    let maxCorrelation = 0;
    let bestLag = 0;
    
    for (let lag = 20; lag < bufferSize / 2; lag++) {
      if (autocorrelation[lag] > maxCorrelation) {
        maxCorrelation = autocorrelation[lag];
        bestLag = lag;
      }
    }
    
    const fundamentalFreq = bestLag > 0 ? sampleRate / bestLag : 0;
    
    // Gender classification based on fundamental frequency
    let gender: 'male' | 'female' | 'unknown' = 'unknown';
    let confidence = 0;
    
    if (fundamentalFreq > 0) {
      if (fundamentalFreq >= 165 && fundamentalFreq <= 265) {
        // Typical female range
        gender = 'female';
        confidence = Math.min(0.9, (fundamentalFreq - 165) / 100 * 0.5 + 0.4);
      } else if (fundamentalFreq >= 85 && fundamentalFreq <= 180) {
        // Typical male range
        gender = 'male';
        confidence = Math.min(0.9, (180 - fundamentalFreq) / 95 * 0.5 + 0.4);
      } else {
        confidence = 0.3;
      }
    }
    
    return { gender, confidence, fundamentalFreq };
  };

  const analyzeAudioBuffer = async (audioBuffer: AudioBuffer, source: 'recording' | 'upload', fileName?: string) => {
    const genderDetection = detectGender(audioBuffer);
    
    // Generate frequency data from audio buffer
    const frequencyData = Array.from({ length: 50 }, (_, i) => {
      const freq = (i / 50) * (audioBuffer.sampleRate / 2);
      return Math.random() * 80 + 20; // Simulated for demo
    });

    const audioBlob = audioChunksRef.current.length > 0 
      ? new Blob(audioChunksRef.current, { type: 'audio/webm' })
      : undefined;

    const analysis: AnalysisData = {
      transcription: currentTranscription,
      offensiveWords: currentTranscription.toLowerCase().split(/\s+/).filter(word => 
        OFFENSIVE_WORDS.some(offensive => word.includes(offensive.toLowerCase()))
      ),
      wordCount: currentTranscription.split(/\s+/).filter(word => word.length > 0).length,
      duration: audioBuffer.duration,
      averageVolume: audioLevel,
      frequencyData,
      audioBlob,
      timestamp: Date.now(),
      id: Date.now().toString(),
      genderDetection,
      source,
      fileName
    };

    setAnalysisData(analysis);
    setIsAnalyzing(false);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        } 
      });

      audioChunksRef.current = [];
      mediaRecorderRef.current = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = async () => {
        if (audioChunksRef.current.length > 0) {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          
          // Convert blob to audio buffer for analysis
          const arrayBuffer = await audioBlob.arrayBuffer();
          const audioContext = new (window.AudioContext || window.webkitAudioContext)();
          
          try {
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            await analyzeAudioBuffer(audioBuffer, 'recording');
          } catch (error) {
            console.error('Error decoding audio:', error);
            // Fallback analysis without audio buffer
            const analysis: AnalysisData = {
              transcription: currentTranscription,
              offensiveWords: currentTranscription.toLowerCase().split(/\s+/).filter(word => 
                OFFENSIVE_WORDS.some(offensive => word.includes(offensive.toLowerCase()))
              ),
              wordCount: currentTranscription.split(/\s+/).filter(word => word.length > 0).length,
              duration: recordingTime,
              averageVolume: audioLevel,
              frequencyData: Array.from({ length: 50 }, () => Math.random() * 100),
              audioBlob,
              timestamp: Date.now(),
              id: Date.now().toString(),
              genderDetection: { gender: 'unknown', confidence: 0, fundamentalFreq: 0 },
              source: 'recording'
            };
            setAnalysisData(analysis);
            setIsAnalyzing(false);
          }
          
          await audioContext.close();
        } else {
          setIsAnalyzing(false);
        }
      };

      // Setup Audio Context for real-time analysis
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      let source: MediaStreamAudioSourceNode | null = null;
      if (audioContextRef.current) {
        source = audioContextRef.current.createMediaStreamSource(stream);
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 256;
        source.connect(analyserRef.current);
      }

      // Setup Speech Recognition
      if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = true;
        recognitionRef.current.interimResults = true;
        recognitionRef.current.lang = 'es-ES';

        recognitionRef.current.onresult = (event: any) => {
          let finalTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcript;
            }
          }
          if (finalTranscript) {
            setCurrentTranscription(prev => prev + ' ' + finalTranscript);
          }
        };

        recognitionRef.current.start();
      }

      mediaRecorderRef.current.start();
      setIsRecording(true);
      setRecordingTime(0);
      setCurrentTranscription('');

      intervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      monitorAudioLevel();

    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('No se pudo acceder al micrófono. Verifica los permisos.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsAnalyzing(true);

      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }

      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      if (audioContextRef.current) {
        audioContextRef.current.close();
      }

      // Stop all tracks
      if (mediaRecorderRef.current.stream) {
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      }
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('audio/')) {
      alert('Por favor selecciona un archivo de audio válido.');
      return;
    }

    setIsAnalyzing(true);
    setCurrentTranscription('Analizando archivo subido...');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      // Store the file as blob for playback
      audioChunksRef.current = [file];
      
      // Simulate transcription for uploaded files (in real app, you'd use a service)
      setCurrentTranscription(`Archivo analizado: ${file.name} - Duración: ${audioBuffer.duration.toFixed(2)}s`);
      
      await analyzeAudioBuffer(audioBuffer, 'upload', file.name);
      await audioContext.close();
      
    } catch (error) {
      console.error('Error processing uploaded file:', error);
      alert('Error al procesar el archivo de audio. Verifica que sea un formato compatible.');
      setIsAnalyzing(false);
    }

    // Reset file input
    event.target.value = '';
  };

  const monitorAudioLevel = () => {
    if (analyserRef.current) {
      const bufferLength = analyserRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      const updateLevel = () => {
        if (analyserRef.current && isRecording) {
          analyserRef.current.getByteFrequencyData(dataArray);
          
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;
          setAudioLevel(average / 255);

          drawFrequencyBars(dataArray, canvasRef.current);
          
          animationRef.current = requestAnimationFrame(updateLevel);
        }
      };
      updateLevel();
    }
  };

  const drawFrequencyBars = (dataArray: Uint8Array, canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);
    
    const barWidth = width / dataArray.length;
    let x = 0;

    for (let i = 0; i < dataArray.length; i++) {
      const barHeight = (dataArray[i] / 255) * height;
      
      const intensity = dataArray[i] / 255;
      if (intensity > 0.7) {
        ctx.fillStyle = '#00ffff';
      } else if (intensity > 0.4) {
        ctx.fillStyle = '#00ff00';
      } else {
        ctx.fillStyle = '#004400';
      }
      ctx.fillRect(x, height - barHeight, barWidth, barHeight);
      
      x += barWidth;
    }
  };

  const playAudio = async () => {
    if (!analysisData?.audioBlob && audioChunksRef.current.length === 0) return;

    if (isPlaying) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      if (playbackContextRef.current) {
        await playbackContextRef.current.close();
      }
      setIsPlaying(false);
      setPlaybackTime(0);
      return;
    }

    try {
      const audioBlob = analysisData?.audioBlob || new Blob(audioChunksRef.current, { type: 'audio/webm' });
      const audioUrl = URL.createObjectURL(audioBlob);
      
      // Create an HTMLAudioElement for playback
      const audioElement = document.createElement('audio');
      audioElement.src = audioUrl;
      audioRef.current = audioElement;

      if (playbackContextRef.current) {
        await playbackContextRef.current.close();
        playbackContextRef.current = null;
      }

      playbackContextRef.current = new (window.AudioContext || window.webkitAudioContext)();

      if (
        playbackContextRef.current &&
        playbackContextRef.current.state === 'suspended' &&
        typeof playbackContextRef.current.resume === 'function'
      ) {
        await playbackContextRef.current.resume();
      }

      let source: MediaElementAudioSourceNode | null = null;
      if (audioRef.current instanceof HTMLAudioElement && playbackContextRef.current) {
        source = playbackContextRef.current.createMediaElementSource(audioRef.current);
        playbackAnalyserRef.current = playbackContextRef.current.createAnalyser();
        playbackAnalyserRef.current.fftSize = 256;

        source.connect(playbackAnalyserRef.current);
        playbackAnalyserRef.current.connect(playbackContextRef.current.destination);
      }

      audioRef.current.onended = () => {
        setIsPlaying(false);
        setPlaybackTime(0);
        URL.revokeObjectURL(audioUrl);
      };

      audioRef.current.ontimeupdate = () => {
        if (audioRef.current) {
          setPlaybackTime(audioRef.current.currentTime);
        }
      };

      audioRef.current.onerror = (error) => {
        console.error('Audio playback error:', error);
        setIsPlaying(false);
        alert('Error al reproducir el audio.');
      };

      await audioRef.current.play();
      setIsPlaying(true);

      monitorPlaybackFrequencies();

    } catch (error) {
      console.error('Error playing audio:', error);
      setIsPlaying(false);
      alert('No se pudo reproducir el audio.');
    }
  };

  const monitorPlaybackFrequencies = () => {
    if (playbackAnalyserRef.current) {
      const bufferLength = playbackAnalyserRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      const updatePlaybackLevel = () => {
        if (playbackAnalyserRef.current && isPlaying) {
          playbackAnalyserRef.current.getByteFrequencyData(dataArray);
          
          drawFrequencyBars(dataArray, playbackCanvasRef.current);
          
          const frequencies = Array.from(dataArray).map(val => (val / 255) * 100);
          setPlaybackFrequencies(frequencies);
          
          requestAnimationFrame(updatePlaybackLevel);
        }
      };
      updatePlaybackLevel();
    }
  };

  const saveSession = () => {
    if (!analysisData || savedSessions.some(s => s.id === analysisData.id)) return;

    setSaveStatus('Guardando...');
    try {
      const now = new Date();
      const sessionName = `Session_${now.getDate().toString().padStart(2, '0')}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getFullYear()}_${now.getHours().toString().padStart(2, '0')}-${now.getMinutes().toString().padStart(2, '0')}`;

      const dataForStorage = {
        ...analysisData,
        audioBlob: undefined
      };

      const newSession: SavedSession = {
        id: analysisData.id,
        name: sessionName,
        timestamp: analysisData.timestamp,
        data: dataForStorage
      };

      const updatedSessions = [...savedSessions, newSession];
      setSavedSessions(updatedSessions);
      
      localStorage.setItem('voiceAnalyzerSessions', JSON.stringify(updatedSessions));
      
      setSaveStatus('✅ Sesión guardada correctamente');
      setTimeout(() => setSaveStatus(''), 3000);
      
    } catch (error) {
      console.error('Error saving session:', error);
      setSaveStatus('❌ Error al guardar la sesión');
      setTimeout(() => setSaveStatus(''), 3000);
    }
  };

  const loadSession = (session: SavedSession) => {
    setAnalysisData(session.data);
    setCurrentTranscription(session.data.transcription);
    setIsPlaying(false);
    setPlaybackTime(0);
    audioChunksRef.current = [];
  };

  const deleteSession = (sessionId: string) => {
    if (confirm('¿Estás seguro de que quieres eliminar esta sesión?')) {
      try {
        const updatedSessions = savedSessions.filter(s => s.id !== sessionId);
        setSavedSessions(updatedSessions);
        localStorage.setItem('voiceAnalyzerSessions', JSON.stringify(updatedSessions));
      } catch (error) {
        console.error('Error deleting session:', error);
        alert('Error al eliminar la sesión.');
      }
    }
  };

  const exportSession = (session: SavedSession) => {
    try {
      const dataStr = JSON.stringify(session, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${session.name}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting session:', error);
      alert('Error al exportar la sesión.');
    }
  };

  const resetAnalysis = () => {
    setAnalysisData(null);
    setCurrentTranscription('');
    setRecordingTime(0);
    setAudioLevel(0);
    setPlaybackTime(0);
    setIsPlaying(false);
    setSaveStatus('');
    audioChunksRef.current = [];
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getGenderIcon = (gender: string) => {
    switch (gender) {
      case 'male': return <User className="text-blue-400" size={16} />;
      case 'female': return <Users className="text-pink-400" size={16} />;
      default: return <User className="text-gray-400" size={16} />;
    }
  };

  const getGenderColor = (gender: string) => {
    switch (gender) {
      case 'male': return 'text-blue-400';
      case 'female': return 'text-pink-400';
      default: return 'text-gray-400';
    }
  };

  const isAlreadySaved = analysisData ? savedSessions.some(s => s.id === analysisData.id) : false;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-black">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-green-400 mb-2 flex items-center justify-center gap-3 font-mono">
            <Terminal className="text-cyan-400" />
            voice_analyzer.exe v4.0
          </h1>
          <p className="text-gray-400 font-mono text-sm">
            <span className="text-cyan-400">$</span> Real-time audio processing, gender detection & file upload toolkit
          </p>
          <div className="flex justify-center items-center gap-4 mt-4">
            <div className="flex items-center gap-2 text-xs text-gray-500 font-mono">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span>SYSTEM ONLINE</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500 font-mono">
              <Cpu size={12} className="text-blue-400" />
              <span>CPU: READY</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500 font-mono">
              <Activity size={12} className="text-purple-400" />
              <span>MIC: STANDBY</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500 font-mono">
              <Save size={12} className="text-yellow-400" />
              <span>SESSIONS: {savedSessions.length}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          {/* Main Content */}
          <div className="xl:col-span-3 space-y-6">
            {/* Recording Controls */}
            <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl p-6 relative overflow-hidden">
              <div className="absolute inset-0 opacity-5">
                <div className="text-green-400 font-mono text-xs leading-none">
                  {Array.from({ length: 20 }, (_, i) => (
                    <div key={i} className="whitespace-nowrap">
                      {Array.from({ length: 100 }, () => Math.random() > 0.5 ? '1' : '0').join('')}
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="flex flex-col items-center space-y-4">
                <div className="text-center mb-4">
                  <p className="text-green-400 font-mono text-sm mb-1">
                    {'>'} AUDIO_INTERFACE_v4.0.0
                  </p>
                  <div className="flex justify-center gap-4 text-xs font-mono">
                    <span className="text-gray-400">STATUS: <span className={isRecording ? 'text-red-400' : 'text-green-400'}>{isRecording ? 'RECORDING' : 'IDLE'}</span></span>
                    <span className="text-gray-400">MODE: <span className="text-cyan-400">ENHANCED</span></span>
                  </div>
                </div>
                
                <div className="flex items-center space-x-4 flex-wrap justify-center">
                  <button
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={isAnalyzing}
                    className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 border-2 font-mono text-sm relative ${
                      isRecording
                        ? 'bg-red-900 border-red-500 hover:bg-red-800 animate-pulse text-red-100'
                        : 'bg-green-900 border-green-500 hover:bg-green-800 hover:scale-105 text-green-100'
                    } disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-green-500/20`}
                    title={isRecording ? 'Detener grabación' : 'Iniciar grabación'}
                  >
                    {isRecording ? <MicOff size={28} /> : <Mic size={28} />}
                    {isRecording && (
                      <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping"></div>
                    )}
                  </button>

                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept="audio/*"
                    className="hidden"
                  />
                  
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isRecording || isAnalyzing}
                    className="w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 border-2 font-mono text-sm bg-orange-900 border-orange-500 hover:bg-orange-800 text-orange-100 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-orange-500/20"
                    title="Subir archivo de audio"
                  >
                    <Upload size={20} />
                  </button>
                  
                  {(analysisData?.audioBlob || audioChunksRef.current.length > 0) && (
                    <button
                      onClick={playAudio}
                      disabled={isAnalyzing}
                      className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 border-2 font-mono text-sm ${
                        isPlaying
                          ? 'bg-yellow-900 border-yellow-500 hover:bg-yellow-800 text-yellow-100'
                          : 'bg-blue-900 border-blue-500 hover:bg-blue-800 text-blue-100'
                      } shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed`}
                      title={isPlaying ? 'Pausar reproducción' : 'Reproducir audio'}
                    >
                      {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                    </button>
                  )}
                  
                  {analysisData && (
                    <>
                      <button
                        onClick={saveSession}
                        disabled={isAnalyzing || saveStatus !== '' || isAlreadySaved}
                        className="px-6 py-3 bg-purple-900 border border-purple-600 hover:bg-purple-800 text-purple-200 rounded-lg transition-colors flex items-center gap-2 font-mono text-sm shadow-lg hover:shadow-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        title={isAlreadySaved ? "Sesión ya guardada" : "Guardar sesión actual"}
                      >
                        <Save size={16} />
                        {isAlreadySaved ? 'SAVED' : (saveStatus === '' ? 'SAVE' : saveStatus)}
                      </button>
                      <button
                        onClick={resetAnalysis}
                        disabled={isAnalyzing}
                        className="px-6 py-3 bg-gray-700 border border-gray-600 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors flex items-center gap-2 font-mono text-sm shadow-lg"
                        title="Limpiar análisis actual"
                      >
                        <RotateCcw size={16} />
                        RESET
                      </button>
                    </>
                  )}
                </div>

                {/* Save Status */}
                {saveStatus && (
                  <div className="text-center">
                    <p className="text-sm font-mono font-semibold">{saveStatus}</p>
                  </div>
                )}

                {/* Recording Status */}
                <div className="text-center">
                  {isRecording && (
                    <div className="space-y-3">
                      <p className="text-red-400 font-mono text-lg font-bold">
                        [REC] {formatTime(recordingTime)}
                      </p>
                      <div className="w-64 bg-gray-700 rounded-full h-3 border border-gray-600">
                        <div 
                          className="bg-gradient-to-r from-green-500 to-cyan-400 h-3 rounded-full transition-all duration-100 shadow-lg shadow-green-500/50"
                          style={{ width: `${audioLevel * 100}%` }}
                        ></div>
                      </div>
                      <p className="text-gray-400 font-mono text-xs">
                        LEVEL: {(audioLevel * 100).toFixed(1)}% | SAMPLES: {recordingTime * 44100}
                      </p>
                    </div>
                  )}
                  {isPlaying && (
                    <div className="space-y-3">
                      <p className="text-blue-400 font-mono text-lg font-bold">
                        [PLAY] {formatTime(playbackTime)} / {formatTime(analysisData?.duration || 0)}
                      </p>
                      <div className="w-64 bg-gray-700 rounded-full h-3 border border-gray-600">
                        <div 
                          className="bg-gradient-to-r from-blue-500 to-purple-400 h-3 rounded-full transition-all duration-100 shadow-lg shadow-blue-500/50"
                          style={{ width: `${((playbackTime / (analysisData?.duration || 1)) * 100)}%` }}
                        ></div>
                      </div>
                    </div>
                  )}
                  {isAnalyzing && (
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
                      <p className="text-cyan-400 font-mono font-semibold">PROCESSING_AUDIO...</p>
                    </div>
                  )}
                </div>

                {/* Real-time Frequency Visualization */}
                {(isRecording || isPlaying) && (
                  <div className="w-full max-w-lg">
                    <div className="text-center mb-2">
                      <p className="text-green-400 font-mono text-sm">
                        {isRecording ? 'FREQUENCY_ANALYZER.dll' : 'PLAYBACK_VISUALIZER.dll'}
                      </p>
                    </div>
                    <canvas
                      ref={isRecording ? canvasRef : playbackCanvasRef}
                      width={512}
                      height={100}
                      className="w-full h-24 bg-black border border-green-500 rounded-lg shadow-lg shadow-green-500/20"
                    />
                    <p className="text-xs text-gray-400 font-mono text-center mt-2">
                      FFT_SIZE: 256 | SAMPLE_RATE: 44.1kHz | BUFFER: {isRecording ? 'REALTIME' : 'PLAYBACK'}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Offensive Words Panel */}
            {analysisData && analysisData.offensiveWords.length > 0 && (
              <div className="bg-gray-800 border border-red-700 rounded-xl shadow-2xl p-6">
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2 text-red-400 font-mono">
                  <AlertTriangle className="text-yellow-400" size={20} />
                  Palabras Ofensivas Detectadas
                </h3>
                <div className="flex flex-wrap gap-2 mt-3">
                  {analysisData.offensiveWords.map((word, index) => (
                    <span key={index} className="bg-red-900 border border-red-700 text-red-300 px-3 py-1 rounded-full text-sm font-mono animate-pulse">
                      {word}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Real-time Transcription */}
            {(isRecording || currentTranscription) && (
              <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl p-6">
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2 text-green-400 font-mono">
                  <Code className="text-cyan-400" size={20} />
                  speech_to_text.py --realtime
                </h3>
                <div className="bg-black border border-gray-600 rounded-lg p-4 min-h-[100px] font-mono">
                  <div className="text-gray-400 text-xs mb-2">
                    <span className="text-green-400">user@voice-analyzer:~$</span> python speech_recognition.py
                  </div>
                  <p className="text-green-300 leading-relaxed">
                    {currentTranscription || (isRecording ? 'Waiting for audio input...' : 'No transcription data available')}
                    {isRecording && <span className="animate-pulse text-cyan-400">█</span>}
                  </p>
                </div>
              </div>
            )}

            {/* Analysis Results */}
            {analysisData && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Transcription Results */}
                <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl p-6">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-green-400 font-mono">
                    <BarChart3 className="text-cyan-400" size={20} />
                    analysis_results.json
                  </h3>
                  <div className="space-y-4">
                    <div className="bg-black border border-gray-600 rounded-lg p-4">
                      <h4 className="font-semibold text-green-400 mb-2 font-mono text-sm">
                        {">"} FINAL_TRANSCRIPT:
                      </h4>
                      <p className="text-gray-300 leading-relaxed font-mono text-sm">
                        "{analysisData.transcription || 'null'}"
                      </p>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-3">
                        <p className="text-blue-400 font-semibold font-mono text-xs">WORD_COUNT</p>
                        <p className="text-2xl font-bold text-blue-300 font-mono">{analysisData.wordCount}</p>
                      </div>
                      <div className="bg-green-900/30 border border-green-700 rounded-lg p-3">
                        <p className="text-green-400 font-semibold font-mono text-xs">DURATION</p>
                        <p className="text-2xl font-bold text-green-300 font-mono">{formatTime(analysisData.duration)}</p>
                      </div>
                    </div>

                    {/* Source Info */}
                    <div className="bg-gray-900/50 border border-gray-600 rounded-lg p-3">
                      <p className="text-gray-400 font-semibold font-mono text-xs mb-1">SOURCE</p>
                      <p className="text-cyan-400 font-mono text-sm">
                        {analysisData.source === 'recording' ? '🎤 MICROPHONE' : '📁 FILE_UPLOAD'}
                        {analysisData.fileName && ` - ${analysisData.fileName}`}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Gender Detection & Offensive Words Panel */}
                <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl p-6">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-green-400 font-mono">
                    <AlertTriangle className="text-red-400" size={20} />
                    voice_analysis.exe
                  </h3>
                  <div className="space-y-4">
                    {/* Gender Detection */}
                    <div className="bg-black border border-gray-600 rounded-lg p-4">
                      <h4 className="font-semibold text-green-400 mb-3 font-mono text-sm flex items-center gap-2">
                        {getGenderIcon(analysisData.genderDetection.gender)}
                        GENDER_DETECTION:
                      </h4>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-400 font-mono text-sm">Detected:</span>
                          <span className={`font-mono text-sm font-bold ${getGenderColor(analysisData.genderDetection.gender)}`}>
                            {analysisData.genderDetection.gender.toUpperCase()}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-400 font-mono text-sm">Confidence:</span>
                          <span className="font-mono text-sm text-cyan-400">
                            {(analysisData.genderDetection.confidence * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-400 font-mono text-sm">Pitch (Hz):</span>
                          <span className="font-mono text-sm text-yellow-400">
                            {analysisData.genderDetection.fundamentalFreq.toFixed(1)}
                          </span>
                        </div>
                        <div className="w-full bg-gray-700 rounded-full h-2 mt-2">
                          <div 
                            className={`h-2 rounded-full transition-all duration-300 ${
                              analysisData.genderDetection.gender === 'male' ? 'bg-blue-500' :
                              analysisData.genderDetection.gender === 'female' ? 'bg-pink-500' : 'bg-gray-500'
                            }`}
                            style={{ width: `${analysisData.genderDetection.confidence * 100}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-black border border-gray-600 rounded-lg p-4">
                      <h4 className="font-semibold text-green-400 mb-2 font-mono text-sm">SYSTEM_STATS:</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-400 font-mono">avg_volume:</span>
                          <span className="font-mono text-cyan-400">{(analysisData.averageVolume * 100).toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400 font-mono">wpm:</span>
                          <span className="font-mono text-cyan-400">
                            {analysisData.duration > 0 ? Math.round((analysisData.wordCount / analysisData.duration) * 60) : 0}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400 font-mono">threat_level:</span>
                          <span className={`font-mono ${
                            analysisData.offensiveWords.length === 0 ? 'text-green-400' : 
                            analysisData.offensiveWords.length <= 2 ? 'text-yellow-400' : 'text-red-400'
                          }`}>
                            {analysisData.offensiveWords.length === 0 ? 'LOW' : 
                             analysisData.offensiveWords.length <= 2 ? 'MEDIUM' : 'HIGH'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Dynamic Frequency Analysis */}
                <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl p-6 lg:col-span-2">
                  <h3 className="text-lg font-semibold mb-4 text-green-400 font-mono flex items-center gap-2">
                    <Activity className="text-cyan-400" size={20} />
                    frequency_spectrum.dat {isPlaying && <span className="text-yellow-400 text-sm animate-pulse">[LIVE]</span>}
                  </h3>
                  <div className="h-48 bg-black border border-gray-600 rounded-lg flex items-end justify-center p-4 space-x-1">
                    {(isPlaying ? playbackFrequencies : analysisData.frequencyData).map((value, index) => (
                      <div
                        key={index}
                        className="bg-gradient-to-t from-green-500 via-cyan-400 to-blue-400 rounded-t transition-all duration-300 hover:shadow-lg hover:shadow-green-500/50"
                        style={{
                          height: `${(value / 100) * 160}px`,
                          width: '8px',
                        }}
                      ></div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 font-mono text-center mt-2">
                    FREQ_RANGE: 20Hz - 20kHz | RESOLUTION: 50_BINS | STATUS: {isPlaying ? 'LIVE_PLAYBACK' : 'ANALYZED'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Saved Sessions Sidebar */}
          <div className="xl:col-span-1">
            <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl p-6 sticky top-8">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-green-400 font-mono">
                <Save className="text-cyan-400" size={20} />
                session_manager.db
              </h3>
              
              {savedSessions.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-400 font-mono text-sm">No saved sessions</p>
                  <p className="text-gray-500 font-mono text-xs mt-2">Record and save to see sessions here</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {savedSessions.map((session) => (
                    <div key={session.id} className="bg-black border border-gray-600 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-mono text-sm text-green-400 truncate">
                          {session.name}
                        </h4>
                        <div className="flex gap-1">
                          <button
                            onClick={() => exportSession(session)}
                            className="p-1 text-blue-400 hover:text-blue-300 transition-colors"
                            title="Export"
                          >
                            <Download size={12} />
                          </button>
                          <button
                            onClick={() => deleteSession(session.id)}
                            className="p-1 text-red-400 hover:text-red-300 transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      
                      <div className="text-xs font-mono text-gray-400 mb-2">
                        <div className="flex justify-between">
                          <span>Words: {session.data.wordCount}</span>
                          <span>Duration: {formatTime(session.data.duration)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Threats: {session.data.offensiveWords.length}</span>
                          <span className="flex items-center gap-1">
                            <Clock size={10} />
                            {new Date(session.timestamp).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex justify-between mt-1">
                          <span className="flex items-center gap-1">
                            {getGenderIcon(session.data.genderDetection.gender)}
                            <span className={getGenderColor(session.data.genderDetection.gender)}>
                              {session.data.genderDetection.gender}
                            </span>
                          </span>
                          <span className="text-gray-500">
                            {session.data.source === 'recording' ? '🎤' : '📁'}
                          </span>
                        </div>
                      </div>
                      
                      <button
                        onClick={() => loadSession(session)}
                        className="w-full px-3 py-1 bg-green-900 border border-green-700 hover:bg-green-800 text-green-300 rounded text-xs font-mono transition-colors"
                        title="Cargar esta sesión"
                      >
                        LOAD_SESSION
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Instructions */}
        {!analysisData && !isRecording && (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 text-center mt-6">
            <h3 className="text-lg font-semibold text-green-400 mb-4 font-mono flex items-center justify-center gap-2">
              <Terminal className="text-cyan-400" size={20} />
              README.md
            </h3>
            <div className="text-gray-300 space-y-2 font-mono text-sm text-left max-w-2xl mx-auto">
              <p className="text-gray-400"># Voice Analyzer v4.0 Usage</p>
              <p><span className="text-cyan-400">1.</span> Click the microphone button to start recording</p>
              <p><span className="text-cyan-400">2.</span> OR click upload button to analyze audio files</p>
              <p><span className="text-cyan-400">3.</span> Speak clearly into your microphone</p>
              <p><span className="text-cyan-400">4.</span> Click again to stop and process audio</p>
              <p><span className="text-cyan-400">5.</span> Use play button to replay recorded audio</p>
              <p><span className="text-cyan-400">6.</span> Click SAVE button to store sessions</p>
              <p><span className="text-cyan-400">7.</span> Load previous sessions from sidebar</p>
              <p className="text-gray-500 mt-4">## New Features v4.0</p>
              <p className="text-gray-400">- Gender detection with confidence levels</p>
              <p className="text-gray-400">- Audio file upload support</p>
              <p className="text-gray-400">- Enhanced session management</p>
              <p className="text-gray-400">- Improved save functionality</p>
              <p className="text-gray-400">- Voice pitch analysis</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Declare SpeechRecognition types
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
    AudioContext: any;
    webkitAudioContext: any;
  }
}

export default App;
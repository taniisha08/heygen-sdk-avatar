// botAvatar.component.js
(function () {
  'use strict';

  angular.module('AvatarPocApp').component('botAvatar', {
    templateUrl: 'botAvatar.tpl.html',
    bindings: {
      // INPUT: Receives text from the parent controller
      textPrompt: '<',
      // OUTPUTS: Notifies the parent controller of events
      onStartSpeaking: '&',
      onStopSpeaking: '&',
      onSessionError: '&',
      apiKey: '<',
    },
    controller: BotAvatarController,
    controllerAs: 'vm',
  });

  /*
   * This controller is a direct port of the working HeyGen vanilla JS example.
   * It uses async/await for clarity and correctly follows the API's sequence:
   * 1. Create a session (`streaming.new`)
   * 2. Prepare the LiveKit connection (`room.prepareConnection`)
   * 3. Start the stream (`streaming.start`)
   * 4. Connect to the LiveKit room (`room.connect`)
   * It relies on the 'activity_idle_timeout' server-side parameter and
   * does NOT use any manual keep-alive pings.
   */
  function BotAvatarController() {
    var vm = this;

    // --- Configuration ---
    const API_CONFIG = {
      // IMPORTANT: Replace with your actual API Key
      // apiKey: vm.apiKey,
      serverUrl: 'https://api.heygen.com',
    };
    const AVATAR_NAME = 'Wayne_20240711'; // Avatar to use
    const VOICE_ID = '68dedac41a9f46a6a4271a95c733823c'; // Optional: Specify a voice

    // --- Internal State ---
    let isReady = false;
    let isSpeaking = false;
    let sessionInfo = null;
    let room = null;
    let webSocket = null;
    let sessionToken = null;
    let mediaElement = null;

    // --- Component Lifecycle Hooks ---

    vm.$onInit = async function () {
      updateStatus('👋 Component Initializing...');
      mediaElement = document.getElementById('mediaElement');
      if (!mediaElement) {
        updateStatus('❌ CRITICAL: Video element not found. Make sure the template is loaded.');
        return;
      }
      mediaElement.autoplay = true;

      try {
        updateStatus('🚀 Starting new session...');
        await getSessionToken();
        await createNewSession();
        await startStreamingSession();
        isReady = true;
        updateStatus('✅ Session is ready and streaming!');
      } catch (error) {
        updateStatus(`❌ Session failed to start: ${error.message}`);
        triggerError('Failed to initialize the avatar session.');
      }
    };

    vm.$onChanges = function (changes) {
      if (isReady && !isSpeaking && changes.textPrompt && changes.textPrompt.currentValue) {
        const text = changes.textPrompt.currentValue;
        updateStatus(`▶️ Received new text prompt: "${text}"`);
        // Using 'repeat' as it's a direct text-to-speech task
        sendText(text, 'repeat');
      }
    };

    vm.$onDestroy = function () {
      updateStatus('🚪 Component destroying. Closing session...');
      closeSession();
    };

    // --- HeyGen API Functions (ported from example) ---

    async function getSessionToken() {
      const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.create_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': vm.apiKey },
      });
      if (!response.ok) throw new Error(`API Error (token): ${response.statusText}`);
      const data = await response.json();
      sessionToken = data.data.token;
      updateStatus('🔑 Session token obtained.');
    }

    async function createNewSession() {
      const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.new`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({
          quality: 'high',
          avatar_name: AVATAR_NAME,
          voice: { voice_id: VOICE_ID },
          version: 'v2',
          activity_idle_timeout: 300, // Rely on server-side timeout
        }),
      });
      if (!response.ok) throw new Error(`API Error (new): ${response.statusText}`);
      const data = await response.json();
      sessionInfo = data.data;
      updateStatus(`🎬 Session created: ${sessionInfo.session_id}`);

      // Setup LiveKit Room and Listeners
      room = new LivekitClient.Room({ adaptiveStream: true, dynacast: true });

      room.on(LivekitClient.RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === 'video' || track.kind === 'audio') {
          mediaElement.srcObject.addTrack(track.mediaStreamTrack);
        }
      });

      room.on(LivekitClient.RoomEvent.DataReceived, (payload) => {
        const msg = JSON.parse(new TextDecoder().decode(payload));
        updateStatus(`ℹ️ Data received: ${msg.type}`);
        if (msg.type === 'avatar_start_speaking') {
          isSpeaking = true;
          if (vm.onStartSpeaking) vm.onStartSpeaking();
        } else if (msg.type === 'avatar_stop_talking') {
          isSpeaking = false;
          if (vm.onStopSpeaking) vm.onStopSpeaking();
        }
      });

      room.on(LivekitClient.RoomEvent.Disconnected, (reason) => {
        updateStatus(`🔌 Room disconnected: ${reason}`);
        triggerError('Avatar session disconnected.');
      });

      // Prepare connection before starting the stream
      mediaElement.srcObject = new MediaStream();
      await room.prepareConnection(sessionInfo.url, sessionInfo.access_token);
      updateStatus('🔧 LiveKit connection prepared.');
    }

    async function startStreamingSession() {
      await fetch(`${API_CONFIG.serverUrl}/v1/streaming.start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ session_id: sessionInfo.session_id }),
      });
      updateStatus('⚡ Stream starting on server...');

      // Now, connect to the room
      await room.connect(sessionInfo.url, sessionInfo.access_token);
      updateStatus('🔗 Connected to LiveKit room.');
    }

    async function sendText(text, taskType) {
      if (!isReady || !sessionInfo) {
        updateStatus('⚠️ Cannot send text, session not ready.');
        return;
      }
      isSpeaking = true; // Set speaking optimistically
      updateStatus(`📤 Sending text (${taskType}): "${text}"`);
      await fetch(`${API_CONFIG.serverUrl}/v1/streaming.task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ session_id: sessionInfo.session_id, text, task_type: taskType }),
      });
    }

    async function closeSession() {
      if (!sessionInfo) return;

      try {
        await fetch(`${API_CONFIG.serverUrl}/v1/streaming.stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
          body: JSON.stringify({ session_id: sessionInfo.session_id }),
        });
        updateStatus('🛑 Session stopped on server.');
      } catch (error) {
        updateStatus(`⚠️ Error stopping session on server: ${error.message}`);
      }

      if (room && room.state === 'connected') {
        room.disconnect();
      }

      // Reset state
      mediaElement.srcObject = null;
      isReady = false;
      sessionInfo = null;
    }

    // --- Helper Functions ---

    function updateStatus(log) {
      const time = new Date().toLocaleTimeString();
      console.log(`[BotAvatar] ${log} - ${time}`);
    }

    function triggerError(message) {
      if (vm.onSessionError) {
        vm.onSessionError({ message: message });
      }
    }
  }
})();
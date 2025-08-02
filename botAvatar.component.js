// botAvatar.component.js
(function () {
  "use strict";

  angular.module("AvatarPocApp").component("botAvatar", {
    templateUrl: "botAvatar.tpl.html",
    bindings: {
      textPrompt: "<",
      onStartSpeaking: "&",
      onStopSpeaking: "&",
      onSessionError: "&",
    },
    controller: BotAvatarController,
    controllerAs: "vm",
  });

  BotAvatarController.$inject = ["$scope"];

  function BotAvatarController($scope) {
    var vm = this;

    // --- PRIVATE VARIABLES ---
    var isSpeaking = false;
    var isReady = false;
    var isDestroying = false;
    var sessionToken = null;
    var sessionInfo = null;
    var room = null;
    var webSocket = null;
    var mediaStream = null;
    var mediaElement = null;
    var sessionStartTime = null;
    var keepAliveInterval = null;

    var API_CONFIG = {
      serverUrl: "https://api.heygen.com",
    };

    var apiKeyInput =
      "ZDc4MDg4NjhlYzJkNGI3Yzg0NzAzY2M4YmUyMzE2ODItMTc1Mzg2NjIwMA==";


    apiKeyInput =
      "YzViZGE5YzZjZjhkNGM2Y2E1NTg3ZjRiZjAyM2RkODktMTc1NDE0MjUxMA==";

    var avatarId = "June_HR_public";
    var voiceId = "68dedac41a9f46a6a4271a95c733823c";

    // --- LIFECYCLE HOOKS ---
    vm.$onInit = function () {
      updateStatus("👋 Initializing component...");
      mediaElement = document.getElementById("mediaElement");
      if (mediaElement) {
        mediaElement.autoplay = true;
      }
      createNewSession().catch(function (error) {
        updateStatus("❌ Initial connection failed:", error);
        triggerError("Failed to initialize session....");
      });
    };

    vm.$onChanges = function (changes) {
      if (isReady && changes.textPrompt && changes.textPrompt.currentValue) {
        sendText(changes.textPrompt.currentValue);
      }
    };

    vm.$onDestroy = function () {
      clearInterval(keepAliveInterval);
      isDestroying = true;
      updateStatus("❌ Component destroyed. Starting full cleanup...");
      if (sessionStartTime) {
        var sessionStopTime = new Date();
        var durationMs = sessionStopTime - sessionStartTime;
        var durationSeconds = durationMs / 1000;
        updateStatus(
          "🕒 Session stopped at: " + sessionStopTime.toLocaleTimeString()
        );
        updateStatus(
          "⏱️ Total session duration: " +
            durationSeconds.toFixed(2) +
            " seconds."
        );
      }

      closeHeyGenSession().finally(function () {
        if (room) {
          room.disconnect();
          updateStatus("🏠 LiveKit room disconnected.....");
        }
        if (webSocket) {
          webSocket.close();
          updateStatus("🔌 WebSocket closed....");
        }
        updateStatus("✅ Full cleanup complete....");
      });
    };

    // --- HEYGEN API COMMUNICATION ---

    function createNewSession() {
      updateStatus("🔑 Getting session token...");
      return fetch(API_CONFIG.serverUrl + "/v1/streaming.create_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": apiKeyInput,
        },
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error("Failed to get session token");
          }
          return response.json();
        })
        .then(function (data) {
          sessionToken = data.data.token;
          updateStatus("🎬 Creating new streaming session...");

          var requestBody = {
            quality: "high",
            version: "v2",
            video_encoding: "H264",
            avatar_id: avatarId,
            voice: {
              voice_id: voiceId,
              rate: 1.0,
            },
            // suppress_events: {
            //   USER_SILENCE: true,
            // },
            activity_idle_timeout: 300,
          };

          return fetch(API_CONFIG.serverUrl + "/v1/streaming.new", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + sessionToken,
            },
            body: JSON.stringify(requestBody),
          });
        })
        .then(function (response) {
          if (!response.ok) {
            throw new Error("Failed to create new session");
          }
          return response.json();
        })
        .then(function (data) {
          sessionInfo = data.data;
          setupLiveKitAndWebSocket();
          updateStatus("🚀 Starting streaming session...");
          return fetch(API_CONFIG.serverUrl + "/v1/streaming.start", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + sessionToken,
            },
            body: JSON.stringify({
              session_id: sessionInfo.session_id,
            }), //send the session id in the response of streaming.start
          });
        })
        .then(function (response) {
          if (!response.ok) {
            throw new Error("Failed to start session");
          }
          return room.connect(sessionInfo.url, sessionInfo.access_token);
        })
        .then(function () {
          isReady = true;
          sessionStartTime = new Date();
          updateStatus("🎉 Streaming started successfully!");
          updateStatus(
            "🕒 Session started at: " + sessionStartTime.toLocaleTimeString()
          );

          startKeepAlive();
          if (vm.textPrompt) {
            sendText(vm.textPrompt);
          }
        });
    }

    function sendText(text) {
      if (!isReady || !sessionInfo) {
        updateStatus("❌ Cannot send text, session not ready.");
        return;
      }
      if (isSpeaking) {
        updateStatus("❌ Bot is already speaking, please wait.");
        return;
      }
      isSpeaking = true;
      updateStatus("📤 Sending text: " + text);
      fetch(API_CONFIG.serverUrl + "/v1/streaming.task", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + sessionToken,
        },
        body: JSON.stringify({
          session_id: sessionInfo.session_id,
          text: text,
          task_type: "repeat",
        }),
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error("API error sending task");
          }
          updateStatus("✅ Text sent successfully.");
        })
        .catch(function (error) {
          isSpeaking = false;
          updateStatus("❌ Error sending text:", error);
          triggerError("Failed to send message.");
        });
    }

    function closeHeyGenSession() {
      if (!sessionInfo || !sessionInfo.session_id) {
        return Promise.resolve();
      }
      updateStatus("🎬 Closing HeyGen session on the server...");
      return fetch(API_CONFIG.serverUrl + "/v1/streaming.stop", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + sessionToken,
        },
        body: JSON.stringify({ session_id: sessionInfo.session_id }),
      })
        .then(function (response) {
          if (!response.ok) {
            return response.text().then(function (text) {
              throw new Error(text);
            });
          }
          updateStatus("✅ HeyGen session closed.");
        })
        .catch(function (error) {
          updateStatus("❌ Error closing HeyGen session:", error);
        });
    }

    // --- WEB SOCKET & LIVEKIT SETUP ---
    function setupLiveKitAndWebSocket() {
      room = new LivekitClient.Room({ adaptiveStream: true, dynacast: true });
      mediaStream = new MediaStream();

      room.on(LivekitClient.RoomEvent.TrackSubscribed, function (track) {
        mediaStream.addTrack(track.mediaStreamTrack);
        mediaElement.srcObject = mediaStream;
      });

      room.on(LivekitClient.RoomEvent.DataReceived, function (message) {
        var decoded = new TextDecoder().decode(message);
        var msgData = JSON.parse(decoded);
        if (msgData.type === "avatar_start_speaking") {
          if (vm.onStartSpeaking) vm.onStartSpeaking();
        }
        if (msgData.type === "avatar_stop_talking") {
          isSpeaking = false;
          if (vm.onStopSpeaking) vm.onStopSpeaking();
        }
      });

      var wsUrl =
        "wss://" +
        new URL(API_CONFIG.serverUrl).hostname +
        "/v1/ws/streaming.chat?session_id=" +
        sessionInfo.session_id +
        "&session_token=" +
        sessionToken;
      webSocket = new WebSocket(wsUrl);
      webSocket.onopen = function () {
        updateStatus("🔌 WebSocket connected");
      };
      webSocket.onerror = function (error) {
        updateStatus("❌ WebSocket Error:", error);
        triggerError("Connection error.");
      };
      webSocket.onclose = function () {
        updateStatus("🔌 WebSocket disconnected");
        if (!isDestroying) {
          updateStatus("🔌 Unexpected disconnection!");
          triggerError("Server timed out.");
        }
      };
    }

    function triggerError(message) {
      if (vm.onSessionError) {
        vm.onSessionError({ message: message });
      }
    }

    function updateStatus(log, args) {
      var time = new Date().toLocaleTimeString();
      console.log("botAvatar : ", log, args || "", "time : ", time);
    }

    function sendKeepAlive() {
      if (!isReady || !sessionToken || !sessionInfo) {
        updateStatus("ERROR : sendKeepAlive returned");
        return;
      }
      updateStatus(
        "keep-alive : Sending keep-alive ping to prevent timeout..."
      );
      fetch(API_CONFIG.serverUrl + "/v1/streaming.keep_alive", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + sessionToken,
        },
        body: JSON.stringify({ session_id: sessionInfo.session_id }),
      })
        .then(function (res) {
          if(res.message == "success"){
            updateStatus("keep-alive : Keep Alive ping success");
          }else{
            updateStatus("keep-alive : keep Alive ping", res);
          }
        
        })
        .catch(function (e) {
          updateStatus("Error : Keep Alive", e);
        });
    }

    function startKeepAlive() {
      updateStatus("keep-alive : interval Started");
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
      }
      keepAliveInterval = setInterval(sendKeepAlive, 15000);
    }
  }
})();

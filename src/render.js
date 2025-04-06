const { desktopCapturer, Menu, dialog } = require("@electron/remote");
const { writeFile } = require("fs");
require("dotenv/config");
const { GoogleGenAI } = require("@google/genai");

let mediaRecorder;
let recordedChunks = [];

const ai = new GoogleGenAI({ apiKey: process.env.GEM_AK });

// Add sleep function
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getVideoSources = async () => {
  try {
    const inputSources = await desktopCapturer.getSources({
      types: ["window", "screen"],
      thumbnailSize: { width: 400, height: 400 },
      fetchWindowIcons: true,
    });

    console.log(
      "Available sources:",
      inputSources.map((s) => s.name)
    );

    const sourcesMenu = Menu.buildFromTemplate(
      inputSources.map((source) => {
        return {
          label: source.name,
          icon: source.appIcon,
          click: () => setVideoSource(source),
        };
      })
    );

    sourcesMenu.popup();
  } catch (error) {
    console.error("Error getting video sources:", error);
    sourceSelectBtn.innerText = "Error: " + error.message;
  }
};

const setVideoSource = async (source) => {
  try {
    sourceSelectBtn.innerText = source.name;

    // Get microphone stream with high quality audio settings
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000,
        channelCount: 2,
      },
      video: false,
    });

    // Get screen stream
    const screenStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: source.id,
        },
      },
    });

    // Combine the audio and video tracks
    const tracks = [
      ...screenStream.getVideoTracks(),
      ...micStream.getAudioTracks(),
    ];
    const combinedStream = new MediaStream(tracks);

    video.srcObject = combinedStream;
    video.play();

    const options = {
      mimeType: "video/webm; codecs=vp9,opus",
      audioBitsPerSecond: 256000, // Increased to 256kbps for better audio
      videoBitsPerSecond: 2500000,
    };
    mediaRecorder = new MediaRecorder(combinedStream, options);

    mediaRecorder.ondataavailable = handleData;
    mediaRecorder.onstop = handleStop;
  } catch (error) {
    console.error("Error setting up streams:", error);
    sourceSelectBtn.innerText = "Error: " + error.message;
  }
};

const handleData = (e) => {
  if (e.data.size > 0) {
    recordedChunks.push(e.data);
  }
};

const handleStop = async (e) => {
  const blob = new Blob(recordedChunks, {
    type: "video/webm; codecs=vp9",
  });

  const buffer = Buffer.from(await blob.arrayBuffer());

  const { filePath } = await dialog.showSaveDialog({
    buttonLabel: "Save video",
    defaultPath: `vid-${Date.now()}.webm`,
  });

  console.log(filePath);
  await writeFile(filePath, buffer, () =>
    console.log("video saved successfully!")
  );

  await sleep(1000);

  await geminiVideoQuery(filePath);
};

const geminiVideoQuery = async (filePath) => {
  try {
    let recording = await ai.files.upload({
      file: require("path").resolve(filePath),
      config: { mimeType: "video/webm" },
    });
    console.log("Uploaded video file:", recording);

    // Poll until the video file is completely processed (state becomes ACTIVE).
    while (!recording.state || recording.state.toString() !== "ACTIVE") {
      console.log("Processing video...");
      console.log("File state: ", recording.state);
      await sleep(5000);
      recording = await ai.files.get({ name: recording.name });
    }

    const result = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              fileData: {
                mimeType: recording.mimeType,
                fileUri: recording.uri,
              },
            },
            {
              text: "You are an AI agent trainer. Your job is to create system prompts to be used for AI agents based on recordings of human interactions with website. You will base your prompt on what you see on the video and on the audio of the voice of the user that has recorded the video.",
            },
          ],
        },
      ],
    });

    console.log("Analysis result:", result.text);
  } catch (error) {
    console.error("Error in Gemini query:", error);
    console.error("Error details:", error.message);
  }
};

const video = document.querySelector("video");
const startBtn = document.getElementById("startButton");
const stopBtn = document.getElementById("stopButton");
const sourceSelectBtn = document.getElementById("selectSourceButton");

sourceSelectBtn.addEventListener("click", getVideoSources);
startBtn.addEventListener("click", () => {
  recordedChunks = [];
  mediaRecorder.start();
  startBtn.classList.add("is-danger");
  startBtn.innerText = "Recording";
});
stopBtn.addEventListener("click", () => {
  mediaRecorder.stop();
  startBtn.classList.remove("is-danger");
  startBtn.innerText = "Start";
});

// For debugging
console.log("Renderer process loaded");

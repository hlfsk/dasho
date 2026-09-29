
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.15";

async function test() {
  try {
    console.log("Starting test...");
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.15/wasm"
    );
    console.log("Vision loaded", vision);
    const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
      },
      runningMode: "VIDEO"
    });
    console.log("FaceLandmarker created", faceLandmarker);
  } catch (e) {
    console.error("Test failed", e);
  }
}

test();

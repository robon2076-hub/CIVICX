# Local privacy model assets

These are inference assets served by CivicX and run on the user's device. Photos are not sent to either model provider.

| Asset | Purpose | Source | Declared license | SHA-256 |
|---|---|---|---|---|
| `blaze_face_short_range.tflite` | Detect nearby faces | [MediaPipe short-range Face Detector](https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite) | Apache-2.0 | `b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f` |
| `blaze_face_full_range.tflite` | Detect faces farther from the camera | [MediaPipe full-range Face Detector](https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite) | Apache-2.0 | `3698b18f063835bc609069ef052228fbe86d9c9a6dc8dcb7c7c2d69aed2b181b` |
| `face_detection_yunet_2023mar.onnx` | Independent server-side face detection | [OpenCV Zoo YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) | MIT; see [`yunet-LICENSE`](./yunet-LICENSE) | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` |
| `license-plate.onnx` | Local plate bounding boxes | [ml-debi YOLOv8 license-plate detector](https://huggingface.co/ml-debi/yolov8-license-plate-detection/tree/8062e8e86734e272c60fa9a819433327ebdb66d7) | MIT, as declared by its model repository | `85d236280a1301ad98907947d284951dd2b20c23a6786ff50f7e6a8ec515bd50` |

The YOLO model repository has a very small model card and does not fully document training-data provenance or accuracy. The repository declares MIT; this is not an independent legal or performance audit. The detectors inspect downscaled images and overlapping tiles; small, obscured, distant, blurry, or unusual faces and plates can still be missed. The backend independently runs YuNet and the plate detector on the uploaded JPEG and rejects detected regions or verification failures before Gemini. Do not treat detector output as a guarantee: review the preview and manually cover missed regions.

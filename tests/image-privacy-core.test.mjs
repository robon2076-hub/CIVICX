import test from "node:test";
import assert from "node:assert/strict";
import * as privacy from "../image-privacy-core.mjs";

test("privacy boxes expand safely and clamp at image edges", () => {
  assert.deepEqual(privacy.clampAndExpandBox({ x: 2, y: 3, width: 10, height: 8 }, 20, 20, 0.2), {
    x: 0,
    y: 0,
    width: 16,
    height: 15
  });
  assert.throws(() => privacy.clampAndExpandBox({ x: 0, y: 0, width: NaN, height: 2 }, 20, 20), /invalid region/i);
});

test("plate tiles overlap and always include the far image edge", () => {
  assert.deepEqual(privacy.tilePositions(640, 640), [0]);
  assert.deepEqual(privacy.tilePositions(1280, 640), [0, 512, 640]);
  assert.throws(() => privacy.tilePositions(0, 640), /tiling dimensions/i);
});

test("YOLO plate output decodes boxes and suppresses duplicate overlaps", () => {
  const output = {
    dims: [1, 5, 3],
    data: Float32Array.from([
      100, 102, 500,
      100, 102, 500,
      40, 40, 20,
      20, 20, 20,
      0.9, 0.8, 0.3
    ])
  };
  const boxes = privacy.decodeYoloPlateOutput(output, 0.2, 640);
  assert.equal(boxes.length, 2);
  assert.deepEqual({ ...boxes[0], score: 0.9 }, { x: 80, y: 90, width: 40, height: 20, score: 0.9 });
  assert.ok(Math.abs(boxes[0].score - 0.9) < 0.001);
  assert.throws(() => privacy.decodeYoloPlateOutput({ dims: [1, 5, 3], data: [1] }), /unsupported output shape/i);
});

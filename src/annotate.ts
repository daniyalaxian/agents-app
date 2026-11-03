import fs from "node:fs"
import path from "node:path"
import { PNG } from "pngjs"

/** One issue area, in percent of the image so the model doesn't need pixel sizes. */
export type AnnotationBox = {
  x: number
  y: number
  width: number
  height: number
  label: string
}

export type AnnotationResult = {
  file: string
  boxes: (AnnotationBox & { n: number })[]
  /** Smaller PNG (base64) for showing the result back to the model. */
  preview: string
}

const RED: [number, number, number] = [229, 50, 45]
const WHITE: [number, number, number] = [255, 255, 255]
const PREVIEW_WIDTH = 1400

/**
 * Draw numbered red boxes on a copy of a PNG screen. The source image is never changed.
 * Box n gets badge "n" at its top-left corner; labels are returned for the legend.
 */
export function annotatePng(sourceFile: string, boxes: AnnotationBox[], outDir: string): AnnotationResult {
  if (!/\.png$/i.test(sourceFile)) throw new Error("Only PNG screens can be annotated. Export the frame as PNG.")
  const image = PNG.sync.read(fs.readFileSync(sourceFile))
  const scale = Math.max(2, Math.round(image.width / 450))
  const stroke = Math.max(3, Math.round(image.width / 400))

  const numbered = boxes.map((box, index) => ({ ...box, n: index + 1 }))
  for (const box of numbered) {
    const x0 = clamp(Math.round((box.x / 100) * image.width), 0, image.width - 1)
    const y0 = clamp(Math.round((box.y / 100) * image.height), 0, image.height - 1)
    const x1 = clamp(Math.round(((box.x + box.width) / 100) * image.width), x0 + 1, image.width)
    const y1 = clamp(Math.round(((box.y + box.height) / 100) * image.height), y0 + 1, image.height)
    tint(image, x0, y0, x1, y1, RED, 0.12)
    fillRect(image, x0, y0, x1, y0 + stroke, RED)
    fillRect(image, x0, y1 - stroke, x1, y1, RED)
    fillRect(image, x0, y0, x0 + stroke, y1, RED)
    fillRect(image, x1 - stroke, y0, x1, y1, RED)
    drawBadge(image, x0, y0, String(box.n), scale)
  }

  fs.mkdirSync(outDir, { recursive: true })
  const base = path.basename(sourceFile, path.extname(sourceFile)).replace(/[^\w.-]+/g, "_").slice(0, 60)
  const file = `${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}-${base}.png`
  fs.writeFileSync(path.join(outDir, file), PNG.sync.write(image))
  return { file, boxes: numbered, preview: PNG.sync.write(shrink(image, PREVIEW_WIDTH)).toString("base64") }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function setPixel(image: PNG, x: number, y: number, [r, g, b]: [number, number, number], alpha = 1) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return
  const i = (image.width * y + x) * 4
  image.data[i] = Math.round(image.data[i] * (1 - alpha) + r * alpha)
  image.data[i + 1] = Math.round(image.data[i + 1] * (1 - alpha) + g * alpha)
  image.data[i + 2] = Math.round(image.data[i + 2] * (1 - alpha) + b * alpha)
  if (alpha === 1) image.data[i + 3] = 255
}

function fillRect(image: PNG, x0: number, y0: number, x1: number, y1: number, color: [number, number, number]) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) setPixel(image, x, y, color)
}

function tint(image: PNG, x0: number, y0: number, x1: number, y1: number, color: [number, number, number], alpha: number) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) setPixel(image, x, y, color, alpha)
}

// 3×5 digits, one string per row.
const DIGITS: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
}

/** Red square with the white number, sitting on the box's top-left corner. */
function drawBadge(image: PNG, x: number, y: number, text: string, scale: number) {
  const pad = scale * 2
  const width = text.length * 4 * scale - scale + pad * 2
  const height = 5 * scale + pad * 2
  const left = clamp(x, 0, Math.max(0, image.width - width))
  const top = clamp(y - height, 0, Math.max(0, image.height - height))
  fillRect(image, left, top, left + width, top + height, RED)
  ;[...text].forEach((char, index) => {
    DIGITS[char]?.forEach((row, ry) =>
      [...row].forEach((bit, rx) => {
        if (bit !== "1") return
        const px = left + pad + index * 4 * scale + rx * scale
        const py = top + pad + ry * scale
        fillRect(image, px, py, px + scale, py + scale, WHITE)
      }),
    )
  })
}

/** Nearest-neighbour downscale, only for the preview sent back to the model. */
function shrink(image: PNG, maxWidth: number): PNG {
  if (image.width <= maxWidth) return image
  const ratio = maxWidth / image.width
  const out = new PNG({ width: maxWidth, height: Math.max(1, Math.round(image.height * ratio)) })
  for (let y = 0; y < out.height; y++) {
    const sy = Math.min(image.height - 1, Math.floor(y / ratio))
    for (let x = 0; x < out.width; x++) {
      const sx = Math.min(image.width - 1, Math.floor(x / ratio))
      image.data.copy(out.data, (out.width * y + x) * 4, (image.width * sy + sx) * 4, (image.width * sy + sx) * 4 + 4)
    }
  }
  return out
}

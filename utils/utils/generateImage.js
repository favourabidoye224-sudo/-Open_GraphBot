const { createCanvas, loadImage } = require("@napi-rs/canvas");

const WIDTH = 1200;
const HEIGHT = 630;

const TEMPLATES = {
  blue: { colors: ["#1e3a8a", "#3b82f6"], text: "#ffffff", accent: "#93c5fd" },
  purple: { colors: ["#4c1d95", "#a855f7"], text: "#ffffff", accent: "#e9d5ff" },
  dark: { colors: ["#0f172a", "#1e293b"], text: "#ffffff", accent: "#38bdf8" },
  sunset: { colors: ["#7c2d12", "#f97316"], text: "#ffffff", accent: "#fed7aa" },
  green: { colors: ["#064e3b", "#10b981"], text: "#ffffff", accent: "#a7f3d0" },
};

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function generateOgImage({ title, description, template = "blue", bgImageBuffer = null }) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  const theme = TEMPLATES[template] || TEMPLATES.blue;

  if (bgImageBuffer) {
    const img = await loadImage(bgImageBuffer);
    const scale = Math.max(WIDTH / img.width, HEIGHT / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
    ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  } else {
    const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    gradient.addColorStop(0, theme.colors[0]);
    gradient.addColorStop(1, theme.colors[1]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.beginPath();
    ctx.arc(WIDTH - 120, 120, 220, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fill();
  }

  const paddingX = 80;
  let cursorY = 240;

  ctx.fillStyle = theme.text;
  ctx.font = "bold 64px sans-serif";
  ctx.textBaseline = "top";
  const titleLines = wrapText(ctx, title || "Untitled", WIDTH - paddingX * 2).slice(0, 3);
  for (const line of titleLines) {
    ctx.fillText(line, paddingX, cursorY);
    cursorY += 76;
  }

  if (description) {
    cursorY += 12;
    ctx.font = "36px sans-serif";
    ctx.fillStyle = theme.accent;
    const descLines = wrapText(ctx, description, WIDTH - paddingX * 2).slice(0, 3);
    for (const line of descLines) {
      ctx.fillText(line, paddingX, cursorY);
      cursorY += 46;
    }
  }

  ctx.font = "24px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillText("Generated with @Open_GraphBot", paddingX, HEIGHT - 60);

  return canvas.toBuffer("image/png");
}

module.exports = { generateOgImage, TEMPLATES };

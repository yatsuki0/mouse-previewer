(() => {
  // Compose the mouse from the rasterized body parts exported by
  // tools/export_mouse_parts.py. Each rig slot applies its original SWF matrix,
  // then draws the part's palette layers (base art, c0 fur layer, c1 accent).
  const rig = window.TFMMouseRigData;
  const partData = window.TFMMousePartData;
  const DEFAULT_COLORS = ['#78583a', '#95d5b6'];

  if (!rig || !partData) {
    console.error('TFMMouseParts: mouse-rig-data.js and mouse-parts-data.js must load first.');
    return;
  }

  const images = new Map();
  const tintCache = new Map();

  function parseMatrix(value) {
    const numbers = String(value || '')
      .slice(String(value).indexOf('(') + 1, String(value).lastIndexOf(')'))
      .split(',')
      .map(Number);
    return numbers.length === 6 && numbers.every(Number.isFinite) ? numbers : [1, 0, 0, 1, 0, 0];
  }

  function multiplyColor(hex) {
    const value = hex.replace('#', '');
    const channels = [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16));
    // The SVG palette filter multiplies each channel by channel / 128.
    return channels.map(channel => Math.min(255, Math.round((channel * 255) / 128)));
  }

  function tinted(image, hex) {
    const key = `${image.src}|${hex}`;
    const cached = tintCache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const value = hex.replace('#', '');
    const multipliers = [0, 2, 4].map(offset =>
      parseInt(value.slice(offset, offset + 2), 16) / 128
    );
    const [r, g, b] = multipliers.map(multiplier =>
      Math.min(255, Math.round(multiplier * 255))
    );
    try {
      // This exactly matches the SVG filter: source * (color / 128).
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < pixels.data.length; index += 4) {
        pixels.data[index] = Math.min(255, Math.round(pixels.data[index] * multipliers[0]));
        pixels.data[index + 1] = Math.min(255, Math.round(pixels.data[index + 1] * multipliers[1]));
        pixels.data[index + 2] = Math.min(255, Math.round(pixels.data[index + 2] * multipliers[2]));
      }
      context.putImageData(pixels, 0, 0);
    } catch (error) {
      // Cross-origin images taint canvases. Keep the preview usable with a
      // multiply fallback when the page and assets are hosted separately.
      context.globalCompositeOperation = 'multiply';
      context.fillStyle = `rgb(${r},${g},${b})`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = 'destination-in';
      context.drawImage(image, 0, 0);
    }
    tintCache.set(key, canvas);
    return canvas;
  }

  class TFMMouseParts {
    constructor(rigData = rig, data = partData) {
      this.rig = rigData;
      this.data = data;
      this.ready = false;
      this.loading = null;
    }

    load() {
      if (this.loading) return this.loading;
      const sources = new Set();
      for (const part of Object.values(this.data.parts)) {
        for (const layer of part.layers) sources.add(layer.src);
      }
      this.loading = Promise.all([...sources].map(src => new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Missing mouse part: ${src}`));
        image.src = src;
        images.set(src, image);
      }))).then(() => {
        this.ready = true;
        return this;
      });
      return this.loading;
    }

    frameCount(kind) {
      return this.rig.frames[kind]?.length || 0;
    }

    drawPart(context, partId, mode, colors) {
      const part = this.data.parts[partId];
      if (!part) return;
      for (const layer of part.layers) {
        if (mode === 'plain' && layer.tint === 'c1') continue;
        const image = images.get(layer.src);
        if (!image?.complete || !image.naturalWidth) continue;
        let source = image;
        if (layer.tint === 'c0') source = tinted(image, colors[0]);
        else if (layer.tint === 'c1') source = tinted(image, colors[1]);

        context.save();
        context.transform(...parseMatrix(layer.transform));
        context.translate(-layer.offsetX, -layer.offsetY);
        context.drawImage(source, 0, 0, layer.width, layer.height);
        context.restore();
      }
    }

    draw(context, kind, frame, options = {}) {
      if (!this.ready) return;
      const {
        x = 0, y = 0, scale = 1, facing = 1,
        mode = 'plain', level = 0, colors = DEFAULT_COLORS,
      } = options;
      const frames = this.rig.frames[kind];
      if (!frames?.length) return;
      const pose = frames[((frame | 0) % frames.length + frames.length) % frames.length];

      context.save();
      context.translate(x, y);
      context.scale(facing * scale, scale);
      context.translate(this.rig.pivotX, this.rig.pivotY);

      for (const slot of pose) {
        const partId = mode === 'plain'
          ? slot.plainPart
          : (level > this.rig.normalMode ? slot.shamanPart : slot.part);
        context.save();
        // SWF alpha comes from the rig frame's color transform; absent means 1.
        context.globalAlpha *= slot.alpha ?? 1;
        context.transform(...parseMatrix(slot.transform));
        this.drawPart(context, partId, mode, colors);

        if (mode === 'shaman' && level === this.rig.shamanDivineMode && slot.wingPart) {
          context.save();
          context.transform(...parseMatrix(slot.wingTransform));
          this.drawPart(context, slot.wingPart, mode, colors);
          context.restore();
        }
        context.restore();
      }
      context.restore();
    }
  }

  window.TFMMouseParts = TFMMouseParts;
})();

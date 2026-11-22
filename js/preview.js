(() => {
  const rig = window.TFMMouseRigData;
  const status = document.querySelector('#status');
  const mouseTypeSelect = document.querySelector('#mouse-type');
  const rendererSelect = document.querySelector('#renderer-type');
  const shamanLevelSelect = document.querySelector('#shaman-level');
  const shamanLevelControl = document.querySelector('#shaman-level-control');
  const furPicker = document.querySelector('#fur-color');
  const accentPicker = document.querySelector('#accent-color');
  const zoomSlider = document.querySelector('#preview-zoom');
  const zoomValue = document.querySelector('#preview-zoom-value');
  const backdropPicker = document.querySelector('#backdrop-color');
  const backdropReset = document.querySelector('#backdrop-reset');
  const stages = {
    idle: document.querySelector('#idle-canvas'),
    run: document.querySelector('#run-canvas'),
  };
  const contexts = {};
  const renderStages = {};
  const outputSupersamples = {};
  const svgStages = {};
  const states = { idle: 0, run: 0 };
  const scales = {};
  const deviceScales = {};
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // One source unit is two CSS pixels at 100%, so the preview keeps a uniform
  // aspect ratio (101x77 -> 202x154) instead of the earlier 206px stretch.
  const CSS_PX_PER_UNIT = 2;
  const BASE_PREVIEW_WIDTH = rig.width * CSS_PX_PER_UNIT;
  const BASE_PREVIEW_HEIGHT = rig.height * CSS_PX_PER_UNIT;
  let updateQueued = false;

  mouseTypeSelect.value = 'plain';
  shamanLevelSelect.value = '0';
  furPicker.value = '#78583a';
  accentPicker.value = '#95d5b6';

  // Deep links make it possible to capture a specific state for comparison,
  // e.g. preview.html?renderer=canvas&zoom=200
  const params = new URLSearchParams(location.search);
  const requestedZoom = Number(params.get('zoom'));
  if (Number.isFinite(requestedZoom) && requestedZoom >= 50 && requestedZoom <= 200) {
    zoomSlider.value = String(Math.round(requestedZoom / 10) * 10);
  }
  if (['canvas', 'svg'].includes(params.get('renderer'))) {
    rendererSelect.value = params.get('renderer');
  }
  if (['plain', 'shaman'].includes(params.get('mouse'))) {
    mouseTypeSelect.value = params.get('mouse');
  }
  const requestedLevel = Number(params.get('level'));
  if (Number.isInteger(requestedLevel) && requestedLevel >= 0 && requestedLevel <= 2) {
    shamanLevelSelect.value = String(requestedLevel);
  }
  // ?backdrop=ff00ff keeps an artefact check reproducible.
  const requestedBackdrop = params.get('backdrop');
  if (/^[0-9a-f]{6}$/i.test(requestedBackdrop || '')) {
    backdropPicker.value = `#${requestedBackdrop}`;
  }

  const mouse = new TFMMouseParts();
  mouse.load().catch(error => {
    status.textContent = error.message;
    console.error(error);
  });

  for (const [kind, canvas] of Object.entries(stages)) {
    renderStages[kind] = document.createElement('canvas');
    contexts[kind] = renderStages[kind].getContext('2d');
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.classList.add('character-canvas', 'character-svg');
    svg.setAttribute('viewBox', `0 0 ${rig.width} ${rig.height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${kind} mouse animation`);
    svg.hidden = true;
    canvas.parentElement.append(svg);
    svgStages[kind] = svg;
  }

  // The bitmap grows with the zoom instead of being CSS-scaled, so the mouse
  // keeps native resolution while it is resized.
  function resizeStages(zoom) {
    const ratio = (window.devicePixelRatio || 1) * zoom;
    // Match the backing bitmap to its displayed size. The source part PNGs
    // are downsampled by drawImage into this bitmap, not later by CSS.
    const pxPerUnit = CSS_PX_PER_UNIT * ratio;
    for (const [kind, canvas] of Object.entries(stages)) {
      const width = Math.max(1, Math.round(rig.width * pxPerUnit));
      const height = Math.max(1, Math.round(rig.height * pxPerUnit));
      // Supersample only below native size, where the downsample improves
      // edges. At 100%+ the device-pixel canvas is already the target raster.
      const outputScale = zoom < 1 ? 4 : 1;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const renderCanvas = renderStages[kind];
      renderCanvas.width = width * outputScale;
      renderCanvas.height = height * outputScale;
      scales[kind] = renderCanvas.width / rig.width;
      outputSupersamples[kind] = outputScale;
    }
  }

  const symbolDocument = new DOMParser().parseFromString(rig.symbols, 'image/svg+xml');
  const symbolRoot = symbolDocument.documentElement;
  const symbolDefs = symbolRoot.querySelector('defs');
  for (const svg of Object.values(svgStages)) {
    if (symbolDefs) svg.append(symbolDefs.cloneNode(true));
  }

  function updateSvgFilters() {
    const values = colors();
    for (const svg of Object.values(svgStages)) {
      for (const index of [0, 1]) {
        const hex = values[index].replace('#', '');
        const channels = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
        const filter = svg.querySelector(`#tfmColor${index}`);
        if (!filter) continue;
        [...filter.querySelectorAll('feFuncR, feFuncG, feFuncB')].forEach((node, i) => {
          node.setAttribute('slope', String(channels[i] / 128));
        });
      }
    }
  }

  function updateZoom() {
    const zoom = Number(zoomSlider.value) / 100;
    zoomValue.value = `${zoomSlider.value}%`;
    resizeStages(zoom);
    for (const [kind, canvas] of Object.entries(stages)) {
      // The element box is the size the mouse is actually drawn at, so the
      // browser never has to scale it: no CSS transform, no overflow, and the
      // art stays centred in its stage at every zoom. The bitmap behind it is
      // sized separately in resizeStages() and may be larger (oversampling).
      canvas.style.width = `${BASE_PREVIEW_WIDTH * zoom}px`;
      canvas.style.height = `${BASE_PREVIEW_HEIGHT * zoom}px`;
      svgStages[kind].style.width = `${BASE_PREVIEW_WIDTH * zoom}px`;
      svgStages[kind].style.height = `${BASE_PREVIEW_HEIGHT * zoom}px`;
      canvas.parentElement.style.height = `${Math.ceil(BASE_PREVIEW_HEIGHT * zoom) + 40}px`;
    }
    draw('idle');
    draw('run');
  }

  function colors() {
    return [furPicker.value, accentPicker.value];
  }

  // A flat backdrop makes it obvious where the composited art is not covering:
  // magenta shows through any seam, white any grey halo. "Stage" restores the
  // sky/ground gradient so the normal look is one click away.
  function setBackdrop(value) {
    for (const canvas of Object.values(stages)) {
      canvas.parentElement.style.background = value;
    }
  }

  function draw(kind) {
    if (rendererSelect.value === 'svg') {
      drawSvg(kind);
      return;
    }
    const context = contexts[kind];
    if (!context) return;
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    mouse.draw(context, kind, states[kind], {
        scale: scales[kind] || 1,
        outputScale: outputSupersamples[kind] || 1,
        mode: mouseTypeSelect.value,
      level: Number(shamanLevelSelect.value),
      colors: colors(),
    });
    const output = stages[kind].getContext('2d');
    output.clearRect(0, 0, output.canvas.width, output.canvas.height);
    output.imageSmoothingEnabled = true;
    output.imageSmoothingQuality = 'high';
    output.drawImage(context.canvas, 0, 0, output.canvas.width, output.canvas.height);
  }

  function drawSvg(kind) {
    const svg = svgStages[kind];
    if (!svg) return;
    svg.querySelectorAll('.mouse-svg-frame').forEach(node => node.remove());
    const group = document.createElementNS(SVG_NS, 'g');
    group.classList.add('mouse-svg-frame');
    group.setAttribute('transform', `translate(${rig.pivotX} ${rig.pivotY})`);
    const pose = rig.frames[kind][states[kind] % rig.frames[kind].length];
    for (const slot of pose) {
      const partId = mouseTypeSelect.value === 'plain'
        ? slot.plainPart
        : (Number(shamanLevelSelect.value) > rig.normalMode ? slot.shamanPart : slot.part);
      const slotGroup = document.createElementNS(SVG_NS, 'g');
      slotGroup.setAttribute('transform', slot.transform.replace(/,/g, ' '));
      if (slot.alpha != null) slotGroup.setAttribute('opacity', slot.alpha);
      const part = document.createElementNS(SVG_NS, 'use');
      part.setAttribute('href', `#${partId}`);
      part.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#${partId}`);
      slotGroup.append(part);
      if (rendererSelect.value === 'svg' && mouseTypeSelect.value === 'shaman' &&
          Number(shamanLevelSelect.value) === rig.shamanDivineMode && slot.wingPart) {
        const wing = document.createElementNS(SVG_NS, 'use');
        wing.setAttribute('href', `#${slot.wingPart}`);
        wing.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#${slot.wingPart}`);
        wing.setAttribute('transform', slot.wingTransform.replace(/,/g, ' '));
        slotGroup.append(wing);
      }
      group.append(slotGroup);
    }
    svg.append(group);
  }

  function update() {
    const isShaman = mouseTypeSelect.value === 'shaman';
    shamanLevelControl.hidden = !isShaman;
    document.querySelector('#accent-control').hidden = !isShaman;
    for (const [kind, canvas] of Object.entries(stages)) {
      const isSvg = rendererSelect.value === 'svg';
      canvas.hidden = isSvg;
      svgStages[kind].hidden = !isSvg;
      canvas.style.display = isSvg ? 'none' : 'block';
      svgStages[kind].style.display = isSvg ? 'block' : 'none';
    }
    updateSvgFilters();
    draw('idle');
    draw('run');
  }

  function updateStatus() {
    const names = ['Normal Mode', 'Hard Mode', 'Divine Mode · wings'];
    const appearance = mouseTypeSelect.value === 'plain'
      ? 'Plain mouse'
      : `Shaman mouse · ${names[Number(shamanLevelSelect.value)]}`;
    const layers = Object.values(window.TFMMousePartData.parts)
      .reduce((total, part) => total + part.layers.length, 0);
    status.textContent = `${appearance} · ${rendererSelect.value.toUpperCase()} renderer · ${layers} layered part images.`;
  }

  function scheduleUpdate() {
    if (updateQueued) return;
    updateQueued = true;
    mouse.clearTintCache();
    requestAnimationFrame(() => {
      updateQueued = false;
      update();
    });
  }

  let previous = 0;
  let accumulated = 0;
  function animate(now) {
    if (!previous) previous = now;
    const elapsed = Math.min((now - previous) / 1000, 0.1);
    previous = now;
    accumulated += elapsed;
    const step = 1 / rig.fps;
    let advanced = false;
    while (accumulated >= step) {
      accumulated -= step;
      for (const kind of ['idle', 'run']) {
        states[kind] = (states[kind] + 1) % mouse.frameCount(kind);
      }
      advanced = true;
    }
    if (advanced) {
      draw('idle');
      draw('run');
    }
    requestAnimationFrame(animate);
  }

  // Color input fires repeatedly while dragging through the native picker.
  // Tinting is CPU-heavy, so redraw once the user commits the chosen color.
  furPicker.addEventListener('change', scheduleUpdate);
  accentPicker.addEventListener('change', scheduleUpdate);
  zoomSlider.addEventListener('input', updateZoom);
  backdropPicker.addEventListener('input', () => setBackdrop(backdropPicker.value));
  backdropReset.addEventListener('click', () => setBackdrop(''));
  // Moving the window to a display with another pixel ratio must re-allocate.
  const pixelRatioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  if (pixelRatioQuery.addEventListener) {
    pixelRatioQuery.addEventListener('change', updateZoom);
  }
  mouseTypeSelect.addEventListener('change', () => { update(); updateStatus(); });
  shamanLevelSelect.addEventListener('change', () => { update(); updateStatus(); });
  rendererSelect.addEventListener('change', () => { update(); updateStatus(); });
  updateZoom();
  update();
  updateStatus();
  if (requestedBackdrop && /^[0-9a-f]{6}$/i.test(requestedBackdrop)) {
    setBackdrop(backdropPicker.value);
  }
  requestAnimationFrame(animate);
})();

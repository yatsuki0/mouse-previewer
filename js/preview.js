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
  const stages = {
    idle: document.querySelector('#idle-canvas'),
    run: document.querySelector('#run-canvas'),
  };
  const contexts = {};
  const svgStages = {};
  const states = { idle: 0, run: 0 };
  const RESOLUTION = 4;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const BASE_PREVIEW_WIDTH = 206;
  const BASE_PREVIEW_HEIGHT = 154;
  let updateQueued = false;

  mouseTypeSelect.value = 'plain';
  shamanLevelSelect.value = '0';
  furPicker.value = '#78583a';
  accentPicker.value = '#95d5b6';

  const mouse = new TFMMouseParts();
  mouse.load().catch(error => {
    status.textContent = error.message;
    console.error(error);
  });

  for (const [kind, canvas] of Object.entries(stages)) {
    canvas.width = Math.round(rig.width * RESOLUTION);
    canvas.height = Math.round(rig.height * RESOLUTION);
    contexts[kind] = canvas.getContext('2d');
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.classList.add('character-canvas', 'character-svg');
    svg.setAttribute('viewBox', `0 0 ${rig.width} ${rig.height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${kind} mouse animation`);
    svg.hidden = true;
    canvas.parentElement.append(svg);
    svgStages[kind] = svg;
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
    for (const [kind, canvas] of Object.entries(stages)) {
      const width = `${BASE_PREVIEW_WIDTH * zoom}px`;
      const height = `${BASE_PREVIEW_HEIGHT * zoom}px`;
      canvas.style.width = width;
      canvas.style.height = height;
      svgStages[kind].style.width = width;
      svgStages[kind].style.height = height;
    }
  }

  function colors() {
    return [furPicker.value, accentPicker.value];
  }

  function draw(kind) {
    if (rendererSelect.value === 'svg') {
      drawSvg(kind);
      return;
    }
    const context = contexts[kind];
    if (!context) return;
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    mouse.draw(context, kind, states[kind], {
      scale: RESOLUTION,
      mode: mouseTypeSelect.value,
      level: Number(shamanLevelSelect.value),
      colors: colors(),
    });
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
    while (accumulated >= step) {
      accumulated -= step;
      for (const kind of ['idle', 'run']) {
        states[kind] = (states[kind] + 1) % mouse.frameCount(kind);
      }
    }
    draw('idle');
    draw('run');
    requestAnimationFrame(animate);
  }

  furPicker.addEventListener('input', scheduleUpdate);
  accentPicker.addEventListener('input', scheduleUpdate);
  zoomSlider.addEventListener('input', updateZoom);
  mouseTypeSelect.addEventListener('change', () => { update(); updateStatus(); });
  shamanLevelSelect.addEventListener('change', () => { update(); updateStatus(); });
  rendererSelect.addEventListener('change', () => { update(); updateStatus(); });
  update();
  updateStatus();
  updateZoom();
  requestAnimationFrame(animate);
})();

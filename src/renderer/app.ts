(function () {
  'use strict';

  // ── Canvas setup ──────────────────────────────────────────────────────────

  const container = document.getElementById('canvas-container') as HTMLDivElement;

  const canvas = new fabric.Canvas('main-canvas', {
    backgroundColor: undefined,
    preserveObjectStacking: true,
    selection: true
  });

  function resizeCanvas(): void {
    canvas.setWidth(container.clientWidth);
    canvas.setHeight(container.clientHeight);
    canvas.renderAll();
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // ── Toolbar references ────────────────────────────────────────────────────

  const inputText      = document.getElementById('input-text')    as HTMLInputElement;
  const fontFamilySel  = document.getElementById('font-family')   as HTMLSelectElement;
  const fontSizeInput  = document.getElementById('font-size')     as HTMLInputElement;
  const fontColorInput = document.getElementById('font-color')    as HTMLInputElement;
  const rotationInput  = document.getElementById('rotation')      as HTMLInputElement;

  // ── Character creation ────────────────────────────────────────────────────

  function addTextToCanvas(text: string): void {
    if (!text.trim()) return;

    const fontFamily = fontFamilySel.value;
    const fontSize   = parseInt(fontSizeInput.value, 10) || 72;
    const fill       = fontColorInput.value;

    // Measure character widths with a temporary canvas context
    const tmpCtx = (document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D);
    tmpCtx.font = `${fontSize}px "${fontFamily}"`;

    // Start position: horizontally centered, vertically centered
    const totalWidth = Array.from(text).reduce((acc, ch) => {
      return acc + (ch === ' ' ? fontSize * 0.3 : tmpCtx.measureText(ch).width + fontSize * 0.05);
    }, 0);

    let cursorX = Math.max(20, (canvas.getWidth() / 2) - totalWidth / 2);
    const startY = canvas.getHeight() / 2 - fontSize / 2;

    Array.from(text).forEach((char, i) => {
      if (char === ' ') {
        cursorX += fontSize * 0.3;
        return;
      }

      const charWidth = tmpCtx.measureText(char).width;

      const obj = new fabric.Text(char, {
        left:            cursorX,
        top:             startY,
        fontFamily:      fontFamily,
        fontSize:        fontSize,
        fill:            fill,
        hasControls:     true,
        hasBorders:      true,
        lockScalingFlip: false,
        data: { charIndex: i, sourceText: text }
      });

      canvas.add(obj);
      cursorX += charWidth + fontSize * 0.05;
    });

    canvas.renderAll();
    inputText.value = '';
  }

  (document.getElementById('btn-add') as HTMLButtonElement).addEventListener('click', () => {
    addTextToCanvas(inputText.value);
  });

  inputText.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') addTextToCanvas(inputText.value);
  });

  // ── Apply property to selected objects ───────────────────────────────────

  function applyToSelection(props: Partial<fabric.ITextOptions>): void {
    const active = canvas.getActiveObjects();
    if (!active.length) return;
    active.forEach(obj => obj.set(props as Partial<fabric.Object>));
    canvas.requestRenderAll();
  }

  fontFamilySel.addEventListener('change', () => {
    applyToSelection({ fontFamily: fontFamilySel.value });
  });

  fontSizeInput.addEventListener('change', () => {
    applyToSelection({ fontSize: parseInt(fontSizeInput.value, 10) || 72 });
  });

  fontColorInput.addEventListener('input', () => {
    applyToSelection({ fill: fontColorInput.value });
  });

  // ── Rotation ──────────────────────────────────────────────────────────────

  (document.getElementById('btn-apply-rotation') as HTMLButtonElement).addEventListener('click', () => {
    const angle = parseFloat(rotationInput.value) || 0;
    applyToSelection({ angle });
  });

  canvas.on('object:rotating', (e: fabric.IEvent) => {
    if (e.target) rotationInput.value = String(Math.round(e.target.angle ?? 0));
  });

  // ── Sync toolbar when selection changes ───────────────────────────────────

  function syncToolbarToSelection(): void {
    const active = canvas.getActiveObject() as fabric.Text | null;
    if (!active || active.type === 'activeSelection') return;
    fontFamilySel.value  = active.fontFamily  ?? fontFamilySel.value;
    fontSizeInput.value  = String(active.fontSize ?? fontSizeInput.value);
    fontColorInput.value = (active.fill as string) ?? fontColorInput.value;
    rotationInput.value  = String(Math.round(active.angle ?? 0));
  }

  canvas.on('selection:created', syncToolbarToSelection);
  canvas.on('selection:updated', syncToolbarToSelection);

  // ── Select all ────────────────────────────────────────────────────────────

  (document.getElementById('btn-select-all') as HTMLButtonElement).addEventListener('click', () => {
    canvas.discardActiveObject();
    const all = canvas.getObjects();
    if (!all.length) return;
    const sel = new fabric.ActiveSelection(all, { canvas });
    canvas.setActiveObject(sel);
    canvas.requestRenderAll();
  });

  // ── Clear canvas ──────────────────────────────────────────────────────────

  (document.getElementById('btn-clear') as HTMLButtonElement).addEventListener('click', () => {
    if (confirm('キャンバスの内容をすべて削除しますか？')) {
      canvas.clear();
      canvas.backgroundColor = '';
      canvas.renderAll();
    }
  });

  // ── PNG export ────────────────────────────────────────────────────────────

  (document.getElementById('btn-export') as HTMLButtonElement).addEventListener('click', async () => {
    canvas.discardActiveObject();
    canvas.renderAll();

    const dataURL = canvas.toDataURL({
      format:              'png',
      multiplier:          2,
      enableRetinaScaling: true
    });

    if (window.electronAPI) {
      const result = await window.electronAPI.savePng(dataURL);
      if (result.success) {
        showToast(`保存しました: ${result.filePath}`);
      } else if (result.reason !== 'canceled') {
        showToast(`エラー: ${result.reason}`, true);
      }
    } else {
      // Fallback for browser testing
      const link = document.createElement('a');
      link.download = 'layout.png';
      link.href = dataURL;
      link.click();
    }
  });

  // ── Toast ─────────────────────────────────────────────────────────────────

  function showToast(message: string, isError = false): void {
    const toast = document.createElement('div');
    toast.className = 'toast' + (isError ? ' toast-error' : '');
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') &&
        document.activeElement === document.body) {
      const active = canvas.getActiveObjects();
      active.forEach(obj => canvas.remove(obj));
      canvas.discardActiveObject();
      canvas.renderAll();
    }
  });

})();

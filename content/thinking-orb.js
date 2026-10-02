// Canvas lifecycle adapter for the official thinking-orbs engine.
const AIThinkingOrb = (() => {
  function mount(canvas, { state = 'working', size = 64, displaySize = size } = {}) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      canvas.hidden = true;
      return () => {};
    }

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${displaySize}px`;
    canvas.style.height = `${displaySize}px`;
    const { mode, speed, opts } = AIThinkingOrbEngine.resolvePreset(state, size);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;
    let visible = true;
    let disposed = false;

    const draw = (time) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const frame = AIThinkingOrbEngine.MODE_FRAMES[mode](size, time, opts);
      // Match the word card's light translucent surface with dark ink.
      AIThinkingOrbEngine.paintFrame(ctx, frame, false);
    };

    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const loop = () => {
      raf = 0;
      if (!canvas.isConnected) {
        dispose();
        return;
      }
      draw((performance.now() / 1000) * speed);
      raf = requestAnimationFrame(loop);
    };
    const sync = () => {
      stop();
      if (disposed) return;
      draw(reducedMotion.matches ? 0.6 : (performance.now() / 1000) * speed);
      if (!reducedMotion.matches && visible && document.visibilityState !== 'hidden') {
        raf = requestAnimationFrame(loop);
      }
    };
    const observer = typeof IntersectionObserver === 'undefined' ? null
      : new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        sync();
      });
    function dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      observer?.disconnect();
      document.removeEventListener('visibilitychange', sync);
      reducedMotion.removeEventListener('change', sync);
    }

    document.addEventListener('visibilitychange', sync);
    reducedMotion.addEventListener('change', sync);
    observer?.observe(canvas);
    sync();
    return dispose;
  }

  return Object.freeze({ mount });
})();

import { useEffect, useRef } from 'react';
import envelopes from './story-envelopes.json';

// The illustration is driven by the current audio clip, not by a separate animation clock.
export function StoryPerformance({ step, audioRef, script, messages, sources, reduced, soundRef }) {
  const canvasRef = useRef(null);
  const input = useRef({ step, audioRef, script, messages, sources, reduced, soundRef });
  input.current = { step, audioRef, script, messages, sources, reduced, soundRef };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let width = 0;
    let height = 0;
    let frame = 0;
    let previous = 0;
    let lastStep = -1;
    let shown = 0;
    let onScreen = true;
    let cards = [];
    const gaze = { x: 0, y: 0, vx: 0, vy: 0 };
    const mouth = { value: 0, velocity: 0 };
    const positions = [
      [.17, .19], [.81, .24], [.1, .40], [.86, .46], [.22, .58], [.78, .64],
      [.32, .12], [.66, .12], [.13, .72], [.9, .72], [.35, .32], [.69, .36],
    ];

    function resize() {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const visibility = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; });
    visibility.observe(canvas);
    resize();

    function ping() {
      const context = input.current.soundRef.current;
      if (!context || context.state !== 'running') return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(610, now);
      oscillator.frequency.exponentialRampToValueAtTime(490, now + .09);
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.035, now + .008);
      gain.gain.exponentialRampToValueAtTime(.0001, now + .12);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + .13);
    }

    function spawn(index) {
      const [positionX, y] = positions[index % positions.length];
      const x = width < 600 ? Math.max(.2, Math.min(.8, positionX)) : positionX;
      const side = x < .5 ? -1 : 1;
      cards.push({ x: side < 0 ? -0.35 : 1.35, y: y + .08, vx: 0, vy: 0,
        tx: x, ty: y, rotation: side * .035, message: index, opacity: 0 });
      if (index && !input.current.reduced) ping();
    }

    function rounded(x, y, w, h, r) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
    }

    function drawCard(card, dt, step) {
      const acceleration = 55;
      if (input.current.reduced) {
        card.x = card.tx; card.y = card.ty; card.opacity = step === 3 ? 0 : 1;
      } else {
      card.vx += (card.tx - card.x) * acceleration * dt;
      card.vy += (card.ty - card.y) * acceleration * dt;
      card.vx *= Math.exp(-9 * dt);
      card.vy *= Math.exp(-9 * dt);
      card.x += card.vx * dt;
      card.y += card.vy * dt;
      card.opacity += ((step === 3 ? 0 : 1) - card.opacity) * Math.min(1, dt * 5);
      }
      const small = width < 600;
      const cardW = small ? Math.min(width * .36, 150) : Math.min(width * .23, 220);
      const cardH = small ? 58 : 69;
      const x = card.x * width;
      const y = card.y * height;
      ctx.save();
      ctx.globalAlpha = card.opacity * .96;
      ctx.translate(x, y);
      ctx.rotate(card.rotation);
      ctx.shadowColor = '#0009';
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 5;
      rounded(-cardW / 2, -cardH / 2, cardW, cardH, 9);
      ctx.fillStyle = '#39423e';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = '#66746b';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#b7d0bd';
      ctx.font = '600 9px sans-serif';
      ctx.fillText(input.current.sources[card.message % input.current.sources.length], -cardW / 2 + 11, -cardH / 2 + 17);
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${small ? 11 : 14}px sans-serif`;
      const text = input.current.messages[card.message % input.current.messages.length];
      const words = text.split(' ');
      let line = '';
      let lineY = -cardH / 2 + 35;
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > cardW - 22 && line) {
          ctx.fillText(line, -cardW / 2 + 11, lineY);
          line = word;
          lineY += 16;
          if (lineY > cardH / 2 - 4) break;
        } else line = next;
      }
      if (lineY <= cardH / 2 - 4) ctx.fillText(line, -cardW / 2 + 11, lineY);
      ctx.restore();
    }

    function drawHead(dt, step, sample, time) {
      const small = width < 600;
      const cx = width / 2;
      const cy = height * (small ? .36 : .39);
      const size = Math.min(width * (small ? .24 : .16), 130);
      const target = cards.at(-1);
      const gx = target ? Math.max(-1, Math.min(1, (target.tx - .5) * 2)) : Math.sin(time * .45) * .25;
      const gy = target ? Math.max(-1, Math.min(1, (target.ty - .35) * 2)) : 0;
      const spring = (value, velocity, goal) => {
        const v = (velocity + (goal - value) * 38 * dt) * Math.exp(-10 * dt);
        return [value + v * dt, v];
      };
      if (input.current.reduced) {
        gaze.x = 0; gaze.y = 0; mouth.value = 0;
      } else {
        [gaze.x, gaze.vx] = spring(gaze.x, gaze.vx, gx);
        [gaze.y, gaze.vy] = spring(gaze.y, gaze.vy, gy);
        [mouth.value, mouth.velocity] = spring(mouth.value, mouth.velocity, sample);
      }
      const angry = step === 2;
      const tilt = (gaze.x * .045) + (angry && !input.current.reduced ? Math.sin(time * 31) * .018 : 0);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tilt);
      const breathing = input.current.reduced ? 1 : 1 + Math.sin(time * 2) * .012;
      ctx.scale(1, breathing);
      ctx.shadowColor = '#0009';
      ctx.shadowBlur = 30;
      ctx.fillStyle = '#f8eee4';
      ctx.strokeStyle = '#231d1c';
      ctx.lineWidth = Math.max(4, size * .055);
      ctx.beginPath();
      ctx.ellipse(0, 0, size, size * .76, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowColor = 'transparent';
      ctx.beginPath();
      ctx.moveTo(-size * .55, size * .55);
      ctx.lineTo(-size * .78, size * .99);
      ctx.lineTo(-size * .21, size * .69);
      ctx.fill();
      ctx.stroke();
      // Eyes follow the newest message; brows lower as the queue grows.
      ctx.fillStyle = '#231d1c';
      for (const direction of [-1, 1]) {
        const ex = direction * size * .31 + gaze.x * size * .05;
        const ey = -size * .13 + gaze.y * size * .035;
        const blink = !input.current.reduced && Math.sin(time * .9) > .997 ? .09 : 1;
        ctx.beginPath();
        ctx.ellipse(ex, ey, size * .055, size * .095 * blink, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineCap = 'round';
        ctx.lineWidth = size * .065;
        ctx.beginPath();
        ctx.moveTo(ex - size * .1, ey - size * (angry ? .19 : .23) + direction * (angry ? size * .065 : -size * .025));
        ctx.lineTo(ex + size * .1, ey - size * (angry ? .19 : .23) - direction * (angry ? size * .065 : -size * .025));
        ctx.stroke();
      }
      const open = Math.max(.06, Math.min(1, mouth.value));
      ctx.beginPath();
      ctx.ellipse(gaze.x * size * .025, size * .29, size * (angry ? .16 : .11), size * (.04 + open * (angry ? .22 : .13)), 0, 0, Math.PI * 2);
      ctx.fill();
      // Red arms and a phone remain part of Wawa's existing character.
      ctx.strokeStyle = '#fa5958';
      ctx.lineWidth = size * .11;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-size * .91, size * .22);
      ctx.quadraticCurveTo(-size * 1.24, size * .4, -size * 1.38, -size * (angry ? .13 : .02));
      ctx.moveTo(size * .91, size * .23);
      ctx.quadraticCurveTo(size * 1.23, size * .38, size * 1.36, -size * .05);
      ctx.stroke();
      ctx.save();
      ctx.translate(size * 1.36, -size * .12);
      ctx.rotate(.18 + gaze.x * .08);
      rounded(-size * .16, -size * .30, size * .32, size * .51, size * .04);
      ctx.fillStyle = '#f8eee4';
      ctx.strokeStyle = '#231d1c';
      ctx.lineWidth = size * .04;
      ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.restore();
    }

    function draw(now) {
      if (!onScreen || document.hidden) {
        previous = now;
        frame = requestAnimationFrame(draw);
        return;
      }
      const { step, audioRef, script, reduced } = input.current;
      const dt = Math.min((now - (previous || now)) / 1000, .035);
      previous = now;
      const audio = audioRef.current;
      if (step !== lastStep) {
        if (step < 0 || step === 0) { cards = []; shown = 0; }
        lastStep = step;
      }
      const elapsed = audio?.currentTime || 0;
      const duration = Number.isFinite(audio?.duration) ? audio.duration : 4;
      const progress = Math.max(0, Math.min(1, elapsed / duration));
      const targetCount = step < 0 ? 1 : step === 0 ? 1 : step === 1 ? 1 + Math.floor(progress * 5) : step === 2 ? 6 + Math.floor(progress * 6) : 12;
      if (step >= 0 && step < 3) while (shown < targetCount) spawn(shown++);
      if (step < 0 && !cards.length) { spawn(0); shown = 1; }
      const samples = step >= 0 && step < 3 ? envelopes[script[step]?.audio.split('/').pop()] || [] : [];
      const sample = reduced || step === 0 ? 0 : samples[Math.floor(elapsed * 20)] || 0;
      ctx.clearRect(0, 0, width, height);
      cards.forEach((card) => drawCard(card, reduced ? .04 : dt, step));
      if (step !== 3) drawHead(dt, step, sample, now / 1000);
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    return () => { observer.disconnect(); visibility.disconnect(); cancelAnimationFrame(frame); };
  }, []);

  return <canvas className="performance-canvas" ref={canvasRef} aria-hidden="true" />;
}

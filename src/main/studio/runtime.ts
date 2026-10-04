/**
 * The small animation library every Studio composition carries, as script text. It runs inside
 * the composition with `root` (the composition's element), `tl` (its one paused timeline) and
 * `K` (px scale, 1 at a 1080 px short side) in scope. Every helper adds fromTo/set tweens at a
 * fixed time, so any frame is a pure function of the playhead.
 */
export const RUNTIME = `
      var H = (function () {
        function q(sel, el) { return (el || root).querySelector(sel); }
        function qa(sel, el) { return Array.prototype.slice.call((el || root).querySelectorAll(sel)); }
        function px(n) { return Math.round(n * K * 10) / 10 + 'px'; }
        return {
          q: q,
          qa: qa,
          /** text rising out of the mask line it sits in */
          rise: function (el, at, o) {
            o = o || {};
            if (!el) return;
            tl.fromTo(el, { yPercent: 108 }, { yPercent: 0, duration: o.dur || 0.55, ease: o.ease || 'expo.out' }, at);
          },
          /** fades in out of a blur, optionally rising a little */
          blurIn: function (el, at, o) {
            o = o || {};
            if (!el) return;
            tl.fromTo(el,
              { opacity: 0, filter: 'blur(' + px(o.blur || 14) + ')', y: (o.y || 0) * K, scale: o.scale || 1 },
              { opacity: 1, filter: 'blur(0px)', y: 0, scale: 1, duration: o.dur || 0.45, ease: o.ease || 'power3.out' },
              at);
          },
          /** scales up from small with a soft overshoot */
          pop: function (el, at, o) {
            o = o || {};
            if (!el) return;
            tl.fromTo(el,
              { opacity: 0, scale: o.from || 0.62, filter: 'blur(' + px(o.blur || 8) + ')' },
              { opacity: 1, scale: 1, filter: 'blur(0px)', duration: o.dur || 0.5, ease: o.ease || 'back.out(1.5)' },
              at);
          },
          /** slides in from the right (dx > 0) or left with a motion blur */
          slideIn: function (el, at, o) {
            o = o || {};
            if (!el) return;
            tl.fromTo(el,
              { opacity: 0, x: (o.dx === undefined ? 220 : o.dx) * K, filter: 'blur(' + px(o.blur || 10) + ')' },
              { opacity: 1, x: 0, filter: 'blur(0px)', duration: o.dur || 0.42, ease: o.ease || 'expo.out' },
              at);
          },
          /** a line drawn left to right (its CSS transform-origin is left) */
          draw: function (el, at, o) {
            o = o || {};
            if (!el) return;
            tl.fromTo(el, { scaleX: 0 }, { scaleX: 1, duration: o.dur || 0.3, ease: o.ease || 'power2.inOut' }, at);
          },
          /** a blurred, grey tile coming into focus */
          focus: function (el, at, o) {
            o = o || {};
            if (!el) return;
            tl.fromTo(el,
              { filter: 'blur(' + px(o.blur || 13) + ') grayscale(1)', opacity: o.dim || 0.5, scale: 0.94 },
              { filter: 'blur(0px) grayscale(0)', opacity: 1, scale: 1, duration: o.dur || 0.38, ease: 'power2.out' },
              at);
          },
          /** shows each .ls-ch inside el one after another, cps characters a second */
          type: function (el, at, cps) {
            if (!el) return 0;
            var chars = qa('.ls-ch', el);
            chars.forEach(function (c, i) { tl.set(c, { display: 'inline' }, at + i / (cps || 14)); });
            return chars.length / (cps || 14);
          },
          /** a caret blinking from start to end, on for 0.5 s and off for 0.5 s */
          blink: function (el, start, end) {
            if (!el) return;
            for (var t = start, on = true; t < end; t += 0.5, on = !on) tl.set(el, { opacity: on ? 1 : 0 }, t);
          },
          /** a hold that keeps moving: a slow push over the whole stretch */
          drift: function (el, start, end, amount) {
            if (!el || end <= start) return;
            tl.fromTo(el, { scale: 1 }, { scale: 1 + (amount || 0.025), duration: end - start, ease: 'none' }, start);
          },
          /** on and off at fixed times */
          show: function (el, at) { if (el) tl.set(el, { opacity: 1 }, at); },
          hide: function (el, at) { if (el) tl.set(el, { opacity: 0 }, at); },
          /** recolors a box at a background change: the theme's CSS variables */
          theme: function (el, at, vars) { if (el) tl.set(el, vars, at); }
        };
      })();
      /** shrinks [data-fit] text until it fits its box on one line */
      function fitAll() {
        H.qa('[data-fit]').forEach(function (el) {
          var box = el.parentNode;
          var max = el.dataset.fit === 'parent' && box ? box.clientWidth : el.clientWidth;
          var size = parseFloat(getComputedStyle(el).fontSize) || 10;
          for (var n = 0; n < 40 && el.scrollWidth > max + 0.5; n++) {
            size *= 0.94;
            el.style.fontSize = Math.round(size * 10) / 10 + 'px';
          }
        });
      }`

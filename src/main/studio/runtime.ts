/**
 * The small animation library every Studio composition carries, as script text. It runs inside
 * the composition with `root` (the composition's element), `tl` (its one paused timeline) and
 * `K` (px scale, 1 at a 1080 px short side) in scope. Every helper adds fromTo/set tweens at a
 * fixed time, so any frame is a pure function of the playhead. An entrance in the first 0.2 s is
 * set in its final state instead: the first frame (the thumbnail) shows the hook already set.
 */
export const RUNTIME = `
      var H = (function () {
        function q(sel, el) { return (el || root).querySelector(sel); }
        function qa(sel, el) { return Array.prototype.slice.call((el || root).querySelectorAll(sel)); }
        function px(n) { return Math.round(n * K * 10) / 10 + 'px'; }
        /**
         * tl.fromTo, except that an entrance in the first 0.2 s is set at build in its end state:
         * a zero-length tween at 0 on a paused timeline isn't reliably rendered on the first seek,
         * and a negative position would shift every other tween on the timeline.
         */
        function enter(el, from, to, at) {
          if (!el) return;
          if (at < 0.2) {
            var end = {};
            for (var k in to) if (k !== 'duration' && k !== 'ease' && k !== 'immediateRender') end[k] = to[k];
            gsap.set(el, end);
            return;
          }
          tl.fromTo(el, from, to, at);
        }
        return {
          q: q,
          qa: qa,
          enter: enter,
          /** text rising out of the mask line it sits in (from: how far below, in % of its height) */
          rise: function (el, at, o) {
            o = o || {};
            enter(el, { yPercent: o.from || 108 }, { yPercent: 0, duration: o.dur || 0.48, ease: o.ease || 'expo.out' }, at);
          },
          /** fades in out of a blur, optionally rising a little: solid within about 0.1 s */
          blurIn: function (el, at, o) {
            o = o || {};
            enter(el,
              { opacity: 0, filter: 'blur(' + px(o.blur || 10) + ')', y: (o.y || 0) * K, scale: o.scale || 1 },
              { opacity: 1, filter: 'blur(0px)', y: 0, scale: 1, duration: o.dur || 0.26, ease: o.ease || 'expo.out' },
              at);
          },
          /** scales up from small with a soft overshoot */
          pop: function (el, at, o) {
            o = o || {};
            enter(el,
              { opacity: 0, scale: o.from || 0.62 },
              { opacity: 1, scale: 1, duration: o.dur || 0.5, ease: o.ease || 'back.out(1.5)' },
              at);
            // the blur clears on its own ease: an overshoot would take it below zero, which CSS
            // rejects, and the frame would keep the blurred start
            if (o.blur !== 0)
              enter(el,
                { filter: 'blur(' + px(o.blur || 8) + ')' },
                { filter: 'blur(0px)', duration: Math.min(0.32, o.dur || 0.5), ease: 'power2.out' },
                at);
          },
          /**
           * slides in from the right (dx > 0) or left with a motion blur; sx stretches it along
           * the move at the start (its CSS transform-origin decides which end stays put)
           */
          slideIn: function (el, at, o) {
            o = o || {};
            var from = { opacity: 0, x: (o.dx === undefined ? 220 : o.dx) * K, filter: 'blur(' + px(o.blur || 10) + ')' };
            var to = { opacity: 1, x: 0, filter: 'blur(0px)', duration: o.dur || 0.42, ease: o.ease || 'expo.out' };
            if (o.sx) { from.scaleX = o.sx; to.scaleX = 1; }
            enter(el, from, to, at);
          },
          /** a line drawn left to right (its CSS transform-origin is left) */
          draw: function (el, at, o) {
            o = o || {};
            enter(el, { scaleX: 0 }, { scaleX: 1, duration: o.dur || 0.3, ease: o.ease || 'power2.inOut' }, at);
          },
          /** a blurred, grey tile snapping into focus the moment its name is said */
          focus: function (el, at, o) {
            o = o || {};
            enter(el,
              { filter: 'blur(' + px(o.blur || 13) + ') grayscale(1)', opacity: o.dim || 0.5, scale: 0.96 },
              { filter: 'blur(0px) grayscale(0)', opacity: 1, scale: 1, duration: o.dur || 0.12, ease: 'power3.out' },
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
          var min = parseFloat(el.dataset.fitMin || '0');
          for (var n = 0; n < 40 && el.scrollWidth > max + 0.5 && size * 0.94 >= min; n++) {
            size *= 0.94;
            el.style.fontSize = Math.round(size * 10) / 10 + 'px';
          }
        });
      }`

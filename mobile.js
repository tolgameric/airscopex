
// AirScopeX Mobile Helpers (drop-in). Include after your main app.js

(function(){
  // 1) Dynamic header height for CSS var (--hdr-h)
  function setHdrHeight(){
    var hdr = document.querySelector('.site-header');
    if(hdr){
      document.documentElement.style.setProperty('--hdr-h', hdr.offsetHeight + 'px');
    }
  }
  window.addEventListener('load', setHdrHeight);
  window.addEventListener('resize', setHdrHeight);

  // 2) 100vh fix on iOS/Android
  function setVH(){
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  }
  window.addEventListener('resize', setVH);
  window.addEventListener('orientationchange', setVH);
  setVH();

  // 3) Drawer open/close helpers
  // Use #drawer element (or .drawer) and toggle class 'is-open'
  function openDrawer(){ toggleDrawer(true); }
  function closeDrawer(){ toggleDrawer(false); }
  function toggleDrawer(open){
    var d = document.querySelector('#drawer') || document.querySelector('.drawer');
    if(!d) return;
    if(open){ d.classList.add('is-open'); document.body.style.overflow='hidden'; }
    else{ d.classList.remove('is-open'); document.body.style.overflow=''; }
  }
  // Expose globally
  window.ASXDrawer = { open: openDrawer, close: closeDrawer, toggle: toggleDrawer };

  // Optional: swipe-down to close on mobile bottom sheet
  const drawer = document.querySelector('#drawer') || document.querySelector('.drawer');
  if(drawer){
    let startY = null, currentY = null, dragging = false;
    const header = drawer.querySelector('.drawer-header') || drawer;
    header.addEventListener('touchstart', (e)=>{
      if(e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      dragging = true;
    }, {passive:true});
    header.addEventListener('touchmove', (e)=>{
      if(!dragging) return;
      currentY = e.touches[0].clientY;
      const dy = Math.max(0, currentY - startY);
      drawer.style.transform = `translateY(${dy}px)`;
    }, {passive:true});
    header.addEventListener('touchend', ()=>{
      if(!dragging) return;
      dragging = false;
      const dy = Math.max(0, (currentY||0) - (startY||0));
      drawer.style.transform = '';
      if(dy > 120){ closeDrawer(); }
    });
  }

  // 4) Prevent background scroll when offcanvas/drawer open (Bootstrap)
  document.addEventListener('shown.bs.offcanvas', ()=>{ document.body.style.overflow='hidden'; });
  document.addEventListener('hidden.bs.offcanvas', ()=>{ document.body.style.overflow=''; });

  // 5) Map touch behavior: allow pinch-zoom, avoid scroll-jacking
  const map = document.getElementById('map');
  if(map){
    map.style.touchAction = 'manipulation'; // tap/drag ok, browser handles zoom nicely
  }
})();

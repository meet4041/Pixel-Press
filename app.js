(() => {
  const MAX_SIZE = 25 * 1024 * 1024;
  const supported = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const state = { jobs: [], processing: false };
  const $ = (s) => document.querySelector(s);
  const dropzone = $('#dropzone'), input = $('#file-input'), panel = $('#app-panel'), list = $('#image-list');
  const fmt = (bytes) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  const esc = (s) => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const setMessage = (text = '') => $('#message').textContent = text;
  const baseName = (name) => name.replace(/\.[^.]+$/, '');
  const extension = (type) => ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[type] || 'jpg');
  // crypto.randomUUID is not exposed by some browsers when this static page is opened locally.
  const makeId = () => globalThis.crypto?.randomUUID?.() || `image-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const getFormat = (job) => $('#format-select').value === 'original' ? job.sourceFile.type : $('#format-select').value;
  const sourceHasTransparency = (job) => job.sourceFile.type === 'image/png' || job.sourceFile.type === 'image/webp';

  function updateUI() {
    panel.hidden = !state.jobs.length;
    $('#image-count').textContent = `${state.jobs.length} image${state.jobs.length === 1 ? '' : 's'} ready`;
    const selectedJpeg = $('#format-select').value === 'image/jpeg';
    $('#transparency-note').hidden = !selectedJpeg || !state.jobs.some(sourceHasTransparency);
    list.innerHTML = state.jobs.map(job => {
      const status = job.status === 'compressing' ? 'Compressing…' : job.status === 'complete' ? (job.compressedSize === job.originalSize ? 'No smaller result available' : `${job.savingsPercent}% smaller`) : job.status === 'error' ? 'Could not process' : 'Ready';
      return `<article class="image-item"><img class="thumb" src="${job.sourceUrl}" alt="Preview of ${esc(job.sourceFile.name)}"><div><div class="file-name" title="${esc(job.sourceFile.name)}">${esc(job.sourceFile.name)}</div><div class="file-meta">Original: ${fmt(job.originalSize)}${job.compressedSize ? ` · Output: ${fmt(job.compressedSize)}` : ''}</div></div><div class="item-actions"><span class="status ${job.status}">${status}</span>${job.status === 'complete' ? `<button class="download-button" type="button" data-download="${job.id}">Download</button>` : ''}<button class="remove-button" type="button" aria-label="Remove ${esc(job.sourceFile.name)}" data-remove="${job.id}">×</button></div></article>`;
    }).join('');
    const complete = state.jobs.filter(j => j.status === 'complete');
    $('#results').hidden = !complete.length;
    $('#zip-button').hidden = complete.length < 2;
    if (complete.length) {
      const original = complete.reduce((sum, j) => sum + j.originalSize, 0), output = complete.reduce((sum, j) => sum + j.compressedSize, 0);
      const saving = original > output ? Math.round((1 - output / original) * 100) : 0;
      $('#summary-copy').textContent = `${complete.length} file${complete.length === 1 ? '' : 's'} ready · ${fmt(original)} → ${fmt(output)} · ${saving}% saved`;
    }
  }
  function addFiles(files) {
    const messages = [];
    [...files].forEach(file => {
      if (!supported.has(file.type)) messages.push(`${file.name}: choose a JPEG, PNG, or WebP image.`);
      else if (file.size > MAX_SIZE) messages.push(`${file.name}: files must be 25 MB or smaller.`);
      else if (state.jobs.some(j => j.sourceFile.name === file.name && j.sourceFile.size === file.size)) messages.push(`${file.name} is already added.`);
      else state.jobs.push({ id: makeId(), sourceFile: file, sourceUrl: URL.createObjectURL(file), originalSize: file.size, status: 'ready' });
    });
    setMessage(messages.join(' ')); updateUI();
  }
  function removeJob(id) { const i = state.jobs.findIndex(j => j.id === id); if (i < 0) return; const [job] = state.jobs.splice(i, 1); URL.revokeObjectURL(job.sourceUrl); if (job.outputUrl) URL.revokeObjectURL(job.outputUrl); updateUI(); }
  function invalidateResults() {
    if (state.processing) return;
    state.jobs.forEach(job => {
      if (job.status !== 'complete') return;
      if (job.outputUrl) URL.revokeObjectURL(job.outputUrl);
      delete job.outputBlob; delete job.outputUrl; delete job.outputName;
      delete job.compressedSize; delete job.savingsPercent;
      job.status = 'ready';
    });
    $('#process-status').textContent = 'Settings changed. Ready to compress again.';
    updateUI();
  }
  function decode(file) { return new Promise((resolve, reject) => { const img = new Image(); const url = URL.createObjectURL(file); img.onload = () => { URL.revokeObjectURL(url); resolve(img); }; img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The image could not be decoded.')); }; img.src = url; }); }
  async function compressJob(job, quality) {
    const type = getFormat(job); const image = await decode(job.sourceFile);
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d'); if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); } ctx.drawImage(image, 0, 0);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('This browser could not encode the selected format.')), type, quality / 100));
    const useOriginal = blob.size >= job.originalSize;
    job.outputBlob = useOriginal ? job.sourceFile : blob;
    job.compressedSize = job.outputBlob.size; job.savingsPercent = Math.max(0, Math.round((1 - job.compressedSize / job.originalSize) * 100));
    job.outputName = `${baseName(job.sourceFile.name)}-compressed.${extension(useOriginal ? job.sourceFile.type : type)}`;
    job.outputUrl = URL.createObjectURL(job.outputBlob); job.status = 'complete';
  }
  async function compressAll() {
    if (state.processing || !state.jobs.length) return; state.processing = true; setMessage(''); const button = $('#compress-button'); button.disabled = true;
    const todo = state.jobs.filter(j => j.status !== 'complete');
    for (let i = 0; i < todo.length; i++) { const job = todo[i]; job.status = 'compressing'; $('#process-status').textContent = `Compressing ${i + 1} of ${todo.length}`; updateUI(); await new Promise(r => setTimeout(r, 20)); try { await compressJob(job, $('#quality-range').value); } catch (e) { job.status = 'error'; job.error = e.message; setMessage(`${job.sourceFile.name}: ${e.message}`); } updateUI(); }
    state.processing = false; button.disabled = false; $('#process-status').textContent = 'Compression complete.'; updateUI();
  }
  function download(job) { const a = document.createElement('a'); a.href = job.outputUrl; a.download = job.outputName; document.body.appendChild(a); a.click(); a.remove(); }
  // A standards-only ZIP writer (store mode) avoids uploading files or depending on a library.
  function crc32(bytes) { let c = -1; for (const b of bytes) { c ^= b; for (let k=0;k<8;k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return (c ^ -1) >>> 0; }
  function u16(n){return [n&255,(n>>>8)&255]} function u32(n){return [n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]}
  async function zipAll() { const jobs = state.jobs.filter(j => j.status === 'complete'); if (jobs.length < 2) return; const out=[], central=[]; let offset=0; for (const job of jobs) { const name=new TextEncoder().encode(job.outputName), data=new Uint8Array(await job.outputBlob.arrayBuffer()), crc=crc32(data); const local=[80,75,3,4,20,0,0,0,0,0,0,0,0,0,...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),0,...name,...data]; out.push(...local); central.push(80,75,1,2,20,0,20,0,0,0,0,0,0,0,...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),0,0,0,0,0,0,0,0,...u32(offset),...name); offset += local.length; } const csize=central.length; const zip=new Blob([new Uint8Array([...out,...central,80,75,5,6,0,0,0,0,...u16(jobs.length),...u16(jobs.length),...u32(csize),...u32(offset),0,0])],{type:'application/zip'}); const url=URL.createObjectURL(zip), a=document.createElement('a'); a.href=url;a.download='pixelpress-compressed-images.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
  dropzone.addEventListener('click', () => input.click()); dropzone.addEventListener('keydown', e => { if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click();} }); input.addEventListener('change', e => {addFiles(e.target.files); input.value='';});
  ['dragenter','dragover'].forEach(event => dropzone.addEventListener(event,e=>{e.preventDefault();dropzone.classList.add('drag-active')})); ['dragleave','drop'].forEach(event => dropzone.addEventListener(event,e=>{e.preventDefault();dropzone.classList.remove('drag-active')})); dropzone.addEventListener('drop',e=>addFiles(e.dataTransfer.files));
  $('#add-more').addEventListener('click',()=>input.click()); $('#quality-range').addEventListener('input',e=>$('#quality-output').textContent=e.target.value); $('#quality-range').addEventListener('change',invalidateResults); $('#format-select').addEventListener('change',invalidateResults); $('#compress-button').addEventListener('click',compressAll); $('#zip-button').addEventListener('click',zipAll); list.addEventListener('click',e=>{const id=e.target.dataset.download||e.target.dataset.remove;if(!id)return;e.target.dataset.download?download(state.jobs.find(j=>j.id===id)):removeJob(id)}); window.addEventListener('beforeunload',()=>state.jobs.forEach(j=>{URL.revokeObjectURL(j.sourceUrl);if(j.outputUrl)URL.revokeObjectURL(j.outputUrl)})); $('#year').textContent=new Date().getFullYear();
})();

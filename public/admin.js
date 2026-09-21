/* Admin panel SPA */
const META = {
  submitted: { label: 'Payment Verify Pending', color: '#64748b' },
  payment_rejected: { label: 'Payment Rejected', color: '#dc2626' },
  correction_needed: { label: 'Correction Requested', color: '#d97706' },
  approved: { label: 'Approved — Booking Queue', color: '#2563eb' },
  booking_in_progress: { label: 'Booking in Progress', color: '#7c3aed' },
  slot_found: { label: 'Slot Found — Confirm', color: '#0d9488' },
  booked: { label: 'Booked ✓', color: '#16a34a' },
  booking_failed: { label: 'Booking Failed', color: '#e11d48' },
  rejected: { label: 'Rejected', color: '#7f1d1d' }
};
let VIEW = 'dashboard', APP_ID = null;

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(iso) { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function pill(s) { const m = META[s] || { label: s, color: '#64748b' }; return `<span class="pill" style="background:${m.color}">${esc(m.label)}</span>`; }
async function api(p, opts = {}) {
  const o = { headers: { 'Content-Type': 'application/json' }, ...opts };
  if (opts.body && typeof opts.body === 'object') o.body = JSON.stringify(opts.body);
  const r = await fetch(p, o);
  if (r.status === 401) { document.getElementById('appView').hidden = true; document.getElementById('loginView').style.display = 'flex'; throw new Error('unauthorized'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Error');
  return j;
}
const post = (p, body) => api(p, { method: 'POST', body });

/* ---------- login ---------- */
async function login() {
  const pw = document.getElementById('loginPw').value;
  const err = document.getElementById('loginErr');
  err.style.display = 'none';
  try {
    await api('/api/admin/login', { method: 'POST', body: { password: pw } });
    document.getElementById('loginView').style.display = 'none';
    document.getElementById('appView').hidden = false;
    document.getElementById('loginPw').value = '';
    go('dashboard');
  } catch (e) { err.style.display = 'block'; err.textContent = 'Password সঠিক নয়।'; }
}
async function logout() { try { await post('/api/admin/logout', {}); } catch (e) {} location.reload(); }

/* ---------- router ---------- */
function go(view, id) {
  VIEW = view; APP_ID = id || null;
  document.querySelectorAll('.sidebar button[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  render();
}
async function render() {
  const main = document.getElementById('main');
  main.innerHTML = '<p style="color:var(--muted)">Loading…</p>';
  try {
    if (VIEW === 'dashboard') main.innerHTML = await vDashboard();
    else if (VIEW === 'apps') main.innerHTML = await vApps();
    else if (VIEW === 'detail') main.innerHTML = await vDetail(APP_ID);
    else if (VIEW === 'receipts') main.innerHTML = await vReceipts();
    else if (VIEW === 'settings') main.innerHTML = await vSettings();
  } catch (e) { main.innerHTML = `<div class="errors">${esc(e.message)}</div>`; }
}

/* ---------- dashboard ---------- */
async function vDashboard() {
  const d = await api('/api/admin/dashboard');
  const order = ['submitted', 'payment_rejected', 'correction_needed', 'approved', 'booking_in_progress', 'slot_found', 'booked', 'booking_failed', 'rejected'];
  const stats = order.filter(s => d.counts[s] > 0 || ['submitted', 'approved', 'booked'].includes(s))
    .map(s => `<div class="stat" style="--sc:${META[s].color}"><div class="n">${d.counts[s]}</div><div class="l">${esc(META[s].label)}</div></div>`).join('');
  const hints = {
    submitted: 'Payment verify / accept করুন',
    approved: 'Booking শুরু করুন',
    slot_found: 'Slot confirm → Mark Booked',
    booking_failed: 'Retry করুন',
    payment_rejected: 'Customer correction wait করছে'
  };
  return `
  <h1>Dashboard</h1><p class="sub">মোট application: <b>${d.total}</b></p>
  <div class="stat-grid">${stats}</div>
  <div class="panel"><h3>⚡ Needs Action</h3>
    <table class="list"><tr><th>App ID</th><th>Customer</th><th>Center</th><th>Status</th><th>Submitted</th><th>Action</th></tr>
    ${d.needsAction.map(a => `<tr class="click" onclick="go('detail','${a.id}')">
      <td style="font-family:Consolas,monospace">${a.id}</td><td>${esc(a.full_name)}</td><td>${esc(a.visa_center)}</td>
      <td>${pill(a.status)}</td><td>${fmt(a.created_at)}</td><td style="color:var(--muted);font-size:12.5px">${hints[a.status] || ''}</td></tr>`).join('') || '<tr><td colspan=6 style="color:var(--muted)">কোনো pending কাজ নেই 🎉</td></tr>'}
    </table>
  </div>
  <div class="panel"><h3>🕘 Recent Applications</h3>
    <table class="list"><tr><th>App ID</th><th>Customer</th><th>Visa</th><th>Center</th><th>Status</th><th>Date</th></tr>
    ${d.recent.map(a => `<tr class="click" onclick="go('detail','${a.id}')">
      <td style="font-family:Consolas,monospace">${a.id}</td><td>${esc(a.full_name)}</td><td>${esc(a.visa_type)}</td><td>${esc(a.visa_center)}</td>
      <td>${pill(a.status)}</td><td>${fmt(a.created_at)}</td></tr>`).join('') || '<tr><td colspan=6 style="color:var(--muted)">এখনো কোনো application আসেনি।</td></tr>'}
    </table>
  </div>`;
}

/* ---------- apps list ---------- */
let F = { status: '', center: '', q: '' };
async function vApps() {
  const params = new URLSearchParams();
  if (F.status) params.set('status', F.status);
  if (F.center) params.set('center', F.center);
  if (F.q) params.set('q', F.q);
  const rows = await api('/api/admin/apps?' + params.toString());
  const centers = [...new Set(rows.map(r => r.visa_center))];
  return `
  <h1>Applications</h1><p class="sub">${rows.length}টি application</p>
  <div class="filters">
    <select onchange="F.status=this.value;render()">
      <option value="">All statuses</option>
      ${Object.entries(META).map(([k, v]) => `<option value="${k}" ${F.status === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}
    </select>
    <select onchange="F.center=this.value;render()">
      <option value="">All centers</option>
      ${centers.map(c => `<option ${F.center === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
    </select>
    <input placeholder="Search name / ID / mobile / passport…" value="${esc(F.q)}" onkeydown="if(event.key==='Enter'){F.q=this.value;render();}">
    <button class="btn btn-sm btn-outline" onclick="F={status:'',center:'',q:''};render()">Clear</button>
    <a class="btn btn-sm btn-ok" style="margin-left:auto" href="/api/admin/export.csv">⬇ Export CSV</a>
  </div>
  <div class="panel" style="padding:6px 10px">
  <table class="list"><tr><th>App ID</th><th>Customer</th><th>Visa</th><th>Center</th><th>Payment</th><th>Status</th><th>Submitted</th></tr>
  ${rows.map(r => `<tr class="click" onclick="go('detail','${r.id}')">
    <td style="font-family:Consolas,monospace">${r.id}</td>
    <td>${esc(r.full_name)}<div style="font-size:11.5px;color:var(--muted)">${esc(r.mobile)}</div></td>
    <td>${esc(r.visa_type)} <small style="color:var(--muted)">(${esc(r.entry_type)})</small></td>
    <td>${esc(r.visa_center)}</td>
    <td>BDT ${esc(r.payment_amount)} ${r.payment_verified ? '<span class="badge-verified">Verified</span>' : '<span class="badge-unverified">Unverified</span>'}</td>
    <td>${pill(r.status)}</td>
    <td>${fmt(r.created_at)}</td></tr>`).join('') || '<tr><td colspan=7 style="color:var(--muted)">কোনো application নেই।</td></tr>'}
  </table></div>`;
}

/* ---------- detail ---------- */
const LBL = {
  full_name: ['Full Name', 'নাম'], gender: ['Gender', 'লাইঙ্গিক'], dob: ['Date of Birth', 'জন্ম তারিখ'],
  nationality: ['Nationality', 'নাগরিকত্ব'], mobile: ['Mobile (OTP)', 'মোবাইল'], email: ['Email', 'ইমেইল'],
  nid_number: ['NID Number', 'এনআইডি'], occupation: ['Occupation', 'পেশা'], employer: ['Employer', 'কর্মসংস্থা'],
  address: ['Address', 'ঠিকানা'], passport_number: ['Passport No.', 'পাসপোর্ট নম্বর'],
  passport_type: ['Passport Type', 'পাসপোর্ট ধরন'], passport_issue_date: ['Issue Date', 'ইস্যু'],
  passport_expiry_date: ['Expiry Date', 'মেয়াদুত্তর'], passport_issue_place: ['Place of Issue', 'ইস্যু স্থান'],
  visa_type: ['Visa Type', 'ভিসার ধরন'], entry_type: ['Entry Type', 'Entry'],
  purpose_detail: ['Purpose', 'উদ্দেশ্য'], arrival_date: ['Arrival', 'যাবার তারিখ'],
  departure_date: ['Departure', 'ফেরার তারিখ'], indian_address: ['Address in India', 'ভারতের ঠিকানা'],
  sponsor_name: ['Sponsor', 'Sponsor'], sponsor_relation: ['Sponsor Relation', 'সম্পর্ক'],
  visa_center: ['Visa Center', 'কেন্দ্র'], pref_earliest: ['Preferred From', 'সর্বনিম্ন'], pref_latest: ['Preferred To', 'সর্বোচ্চ']
};
function kv(fields, obj) {
  return `<div class="kv">${fields.map(f => `<div><span class="k">${LBL[f][0]} <small style="color:#94a3b8">${LBL[f][1]}</small></span><span class="v">${esc(obj[f] || '—')}</span></div>`).join('')}</div>`;
}

async function vDetail(id) {
  const a = await api('/api/admin/apps/' + id);
  const s = a.status;

  /* action bar per status */
  let actions = '';
  if (s === 'submitted') {
    actions = `
      <button class="btn btn-ok btn-sm" onclick="actPayment()">${a.payment_verified ? '✓ Payment Verified' : '✓ Payment Verified (verify করুন)'}</button>
      <button class="btn btn-danger btn-sm" onclick="toggleForm('payRej')">✗ Payment Reject</button>
      <button class="btn btn-warn btn-sm" onclick="toggleForm('corrReq')">📝 Request Correction</button>
      ${a.payment_verified ? '<button class="btn btn-primary btn-sm" onclick="setStatus(\'approved\')">✓ Accept Application → Booking Queue</button>' : ''}`;
  } else if (s === 'payment_rejected') {
    actions = `<button class="btn btn-outline btn-sm" onclick="setStatus('submitted')">↩ Re-open (Pending)</button>`;
  } else if (s === 'correction_needed') {
    actions = `<span class="notice" style="margin:0">Customer-এর response wait করা হচ্ছে। Customer status page-এ correction দিলে automatically pending হবে।</span>
      <button class="btn btn-outline btn-sm" onclick="setStatus('submitted')">↩ Back to Pending (no correction needed)</button>`;
  } else if (s === 'approved') {
    actions = `<button class="btn btn-primary btn-sm" onclick="setStatus('booking_in_progress')">▶ Start Booking</button>
      <a class="btn btn-outline btn-sm" target="_blank" href="/api/admin/apps/${a.id}/sheet">📄 Open Booking Sheet</a>`;
  } else if (s === 'booking_in_progress' || s === 'slot_found') {
    actions = `
      <button class="btn btn-ok btn-sm" onclick="toggleForm('slotForm')">🎯 Slot Found (date/time দিন)</button>
      <button class="btn btn-primary btn-sm" onclick="toggleForm('bookedForm')">✓ Mark Booked (Booking ID দিন)</button>
      <button class="btn btn-danger btn-sm" onclick="toggleForm('failForm')">✗ Booking Failed</button>
      <a class="btn btn-outline btn-sm" target="_blank" href="/api/admin/apps/${a.id}/sheet">📄 Booking Sheet</a>`;
  } else if (s === 'booked') {
    actions = `<a class="btn btn-ok btn-sm" href="/api/admin/apps/${a.id}/receipt" target="_blank">🧾 Open Receipt</a>
      <a class="btn btn-outline btn-sm" href="/api/admin/apps/${a.id}/receipt" download>⬇ Download Receipt PDF</a>`;
  } else if (s === 'booking_failed') {
    actions = `<div class="notice" style="margin:0">❌ Reason: ${esc(a.booking_failed_reason || '—')}</div>
      <button class="btn btn-primary btn-sm" onclick="setStatus('booking_in_progress')">↻ Retry Booking</button>`;
  } else if (s === 'rejected') {
    actions = `<div class="notice" style="margin:0">Reason: ${esc(a.rejection_reason || '—')}</div>
      <button class="btn btn-outline btn-sm" onclick="setStatus('submitted')">↩ Re-open</button>`;
  }

  const docs = a.files.map(f => {
    const isImg = (f.mime || '').startsWith('image/');
    const inner = isImg
      ? `<img loading="lazy" src="/api/admin/files/${f.id}" alt="">`
      : `<div style="height:110px;display:flex;align-items:center;justify-content:center;font-size:34px">📄</div>`;
    const tag = f.file_type === 'photo' ? '📷' : f.file_type === 'passport_bio' ? '🛂' : '📎';
    return `<div class="doc-item">${inner}<div class="cap"><span>${tag} ${esc(f.original_name).slice(0, 18)}</span><a href="/api/admin/files/${f.id}" target="_blank">open</a></div></div>`;
  }).join('');

  return `
  <a href="javascript:go('apps')">← সব applications</a>
  <h1 style="margin-top:10px"><span style="font-family:Consolas,monospace">${a.id}</span>  ${pill(s)}</h1>
  <p class="sub">${esc(a.full_name)} • ${esc(a.mobile)} • submitted ${fmt(a.created_at)}${a.booking_at ? ' • booked ' + fmt(a.booking_at) : ''}</p>
  <div class="action-bar" id="actionBar">${actions}</div>

  <div id="payRej" class="inline-form" hidden>
    <b>Payment Reject — reason (customer দেখবে)</b>
    <div class="grid1" style="margin-top:8px"><textarea id="payRejNote" placeholder="e.g. TrxID-তে এত টাকা আসেনি / sender number মিলছে না"></textarea></div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn btn-danger btn-sm" onclick="doPayment(0)">Reject করুন</button>
      <button class="btn btn-outline btn-sm" onclick="toggleForm('payRej')">Cancel</button>
    </div>
  </div>

  <div id="corrReq" class="inline-form" hidden>
    <b>Correction Request — customer-কে বলুন কোন তথ্য সঠিক করবে</b>
    <div class="grid1" style="margin-top:8px"><textarea id="corrMsg" placeholder="e.g. Passport expiry date ভুল দিতে হয়েছে — 6 month-এর কম validity আছে"></textarea></div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn btn-warn btn-sm" onclick="doCorrection()">Send করুন</button>
      <button class="btn btn-outline btn-sm" onclick="toggleForm('corrReq')">Cancel</button>
    </div>
  </div>

  <div id="slotForm" class="inline-form" hidden>
    <b>Slot Found — appointment date/time</b>
    <div class="grid2" style="margin-top:8px">
      <div class="field"><label>Date <span class="req">*</span></label><input type="date" id="slotDate"></div>
      <div class="field"><label>Time <span class="req">*</span></label><input type="text" id="slotTime" placeholder="e.g. 10:30 AM"></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn btn-ok btn-sm" onclick="doSlot()">Save করুন</button>
      <button class="btn btn-outline btn-sm" onclick="toggleForm('slotForm')">Cancel</button>
    </div>
  </div>

  <div id="bookedForm" class="inline-form" hidden>
    <b>Booking Complete — official confirmation details (receipt PDF automatic হবে)</b>
    <div class="grid2" style="margin-top:8px">
      <div class="field"><label>Booking / Appointment ID <span class="req">*</span></label><input id="bkId" placeholder="Official website-এর booking number"></div>
      <div class="field"><label>Official Payment Ref (optional)</label><input id="bkPayRef" placeholder="Official site-এর payment reference"></div>
      <div class="field"><label>Appointment Date <span class="req">*</span></label><input type="date" id="bkDate" value="${esc(a.appointment_date || '')}"></div>
      <div class="field"><label>Appointment Time <span class="req">*</span></label><input id="bkTime" value="${esc(a.appointment_time || '')}" placeholder="e.g. 10:30 AM"></div>
    </div>
    <div class="grid1"><div class="field"><label>Notes (optional)</label><textarea id="bkNotes" placeholder="যেমন: customer-কে যা জানাতে হবে"></textarea></div></div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn btn-primary btn-sm" onclick="doBooked()">✓ Mark Booked + Generate Receipt</button>
      <button class="btn btn-outline btn-sm" onclick="toggleForm('bookedForm')">Cancel</button>
    </div>
  </div>

  <div id="failForm" class="inline-form" hidden>
    <b>Booking Failed — reason</b>
    <div class="grid1" style="margin-top:8px"><textarea id="failReason" placeholder="e.g. slot expired / payment issue / customer unreachable"></textarea></div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn btn-danger btn-sm" onclick="doFailed()">Mark Failed</button>
      <button class="btn btn-outline btn-sm" onclick="toggleForm('failForm')">Cancel</button>
    </div>
  </div>

  <div class="detail-grid">
    <div>
      <div class="panel"><h3>👤 Personal</h3>${kv(['full_name', 'gender', 'dob', 'nationality', 'mobile', 'email', 'nid_number', 'occupation', 'employer', 'address'], a)}</div>
      <div class="panel"><h3>🛂 Passport</h3>${kv(['passport_number', 'passport_type', 'passport_issue_date', 'passport_expiry_date', 'passport_issue_place'], a)}</div>
      <div class="panel"><h3>🛫 Visa Details</h3>${kv(['visa_type', 'entry_type', 'purpose_detail', 'arrival_date', 'departure_date', 'indian_address', 'sponsor_name', 'sponsor_relation'], a)}</div>
      <div class="panel"><h3>📍 Slot Preference</h3>${kv(['visa_center', 'pref_earliest', 'pref_latest'], a)}</div>
    </div>
    <div>
      <div class="panel"><h3>💳 Payment (bKash)</h3>
        ${kv(['payment_amount', 'payment_trx_id', 'payment_date', 'payment_from_number'], a)}
        <div style="margin-top:10px">${a.payment_verified ? `<span class="badge-verified">Verified ✓ ${fmt(a.payment_verified_at)}</span>` : '<span class="badge-unverified">Not verified yet</span>'}${a.payment_note ? `<div class="hint">${esc(a.payment_note)}</div>` : ''}</div>
        <div class="hint">Fees: service BDT ${esc(a.service_fee)} + official BDT ${esc(a.official_fee)} = BDT ${esc(a.total_paid)}</div>
      </div>
      <div class="panel"><h3>📄 Documents (${a.files.length})</h3><div class="doc-grid">${docs || '<span style="color:var(--muted)">no files</span>'}</div></div>
      <div class="panel"><h3>🔢 OTP Log</h3>
        <div class="grid2" style="margin-bottom:8px">
          <div class="field"><label>OTP</label><input id="otpVal" placeholder="e.g. 4821"></div>
          <div class="field"><label>Purpose</label><input id="otpPurpose" placeholder="login / booking / payment"></div>
        </div>
        <button class="btn btn-outline btn-sm" onclick="addOtp()">+ Record OTP</button>
        <ul class="timeline" style="margin-top:14px">${(a.otps || []).map(o => `<li><div class="t-time">${fmt(o.created_at)} • ${esc(o.purpose || 'general')}</div>OTP: <b>${esc(o.otp)}</b></li>`).join('') || '<li style="border:0;padding-left:0"><span style="color:var(--muted)">কোনো OTP record করা হয়নি।</span></li>'}</ul>
      </div>
      <div class="panel"><h3>📖 History</h3>
        <ul class="timeline">${a.timeline.map(t => `<li><div class="t-time">${fmt(t.created_at)}</div>${esc(t.note || t.status)}</li>`).join('')}</ul>
      </div>
    </div>
  </div>`;
}

/* ---------- actions ---------- */
function toggleForm(id) { const el = document.getElementById(id); el.hidden = !el.hidden; }
function actPayment() {
  if (!confirm('bKash app-এ TrxID চেক করে verify করেছেন?')) return;
  doPayment(1);
}
async function doPayment(verified) {
  const note = verified ? (prompt('Note (optional)?') || '') : (document.getElementById('payRejNote').value || 'Payment could not be verified.');
  try {
    if (!verified && !note.trim()) return alert('Reason দিতে হবে।');
    await post(`/api/admin/apps/${APP_ID}/payment`, { verified, note });
    render();
  } catch (e) { alert(e.message); }
}
async function doCorrection() {
  const message = document.getElementById('corrMsg').value;
  if (!message.trim()) return alert('Message দিতে হবে।');
  try { await post(`/api/admin/apps/${APP_ID}/correction`, { message }); render(); } catch (e) { alert(e.message); }
}
async function setStatus(status, extra) {
  try { await post(`/api/admin/apps/${APP_ID}/status`, { status, ...extra }); render(); } catch (e) { alert(e.message); }
}
async function doSlot() {
  const date = document.getElementById('slotDate').value, time = document.getElementById('slotTime').value;
  if (!date || !time) return alert('Date ও time দিতে হবে।');
  setStatus('slot_found', { appointment_date: date, appointment_time: time });
}
async function doBooked() {
  const booking_id = document.getElementById('bkId').value.trim();
  const appointment_date = document.getElementById('bkDate').value;
  const appointment_time = document.getElementById('bkTime').value.trim();
  const official_payment_ref = document.getElementById('bkPayRef').value.trim();
  const booking_notes = document.getElementById('bkNotes').value.trim();
  if (!booking_id || !appointment_date || !appointment_time) return alert('Booking ID, date ও time — তিনটাই দিতে হবে।');
  if (!confirm('Booking complete? Receipt PDF automatically তৈরি হবে।')) return;
  setStatus('booked', { booking_id, appointment_date, appointment_time, official_payment_ref, booking_notes });
}
async function doFailed() {
  const reason = document.getElementById('failReason').value.trim();
  if (!reason) return alert('Reason দিতে হবে।');
  setStatus('booking_failed', { note: reason });
}
async function addOtp() {
  const otp = document.getElementById('otpVal').value.trim();
  const purpose = document.getElementById('otpPurpose').value.trim();
  if (!otp) return alert('OTP দিতে হবে।');
  try { await post(`/api/admin/apps/${APP_ID}/otp`, { otp, purpose }); render(); } catch (e) { alert(e.message); }
}

/* ---------- receipts ---------- */
async function vReceipts() {
  const rows = await api('/api/admin/receipts');
  return `
  <h1>Receipts</h1><p class="sub">Booking সফল হলে receipt PDF এখানে automatic চলে আসে</p>
  <div class="panel"><table class="list"><tr><th>App ID</th><th>Customer</th><th>Center</th><th>Appointment</th><th>Booking ID</th><th>Generated</th><th></th></tr>
  ${rows.map(r => `<tr>
    <td style="font-family:Consolas,monospace" class="click" onclick="go('detail','${r.id}')">${r.id}</td>
    <td>${esc(r.full_name)}</td><td>${esc(r.visa_center)}</td>
    <td>${esc(r.appointment_date)} ${esc(r.appointment_time)}</td>
    <td>${esc(r.booking_id)}</td><td>${fmt(r.receipt_generated_at)}</td>
    <td><a class="btn btn-ok btn-sm" href="/api/admin/apps/${r.id}/receipt" download>⬇ PDF</a></td></tr>`).join('') || '<tr><td colspan=7 style="color:var(--muted)">এখনো কোনো receipt তৈরি হয়নি।</td></tr>'}
  </table></div>`;
}

/* ---------- settings ---------- */
async function vSettings() {
  const s = await api('/api/admin/settings');
  return `
  <h1>Settings</h1><p class="sub">Website-এর configuration — save করলেই live</p>
  <form id="setForm">
  <div class="panel"><h3>Business & Payment</h3>
    <div class="grid2">
      <div class="field"><label>Business Name</label><input name="business_name" value="${esc(s.business_name)}"></div>
      <div class="field"><label>bKash Number (customer-এর দেখাবে)</label><input name="bkash_number" value="${esc(s.bkash_number)}" placeholder="01XXXXXXXXX"></div>
      <div class="field"><label>Service Fee (BDT)</label><input name="service_fee" type="number" value="${esc(s.service_fee)}"></div>
      <div class="field"><label>IVAC Official Fee (BDT)</label><input name="official_fee" type="number" value="${esc(s.official_fee)}"><div class="hint">IVAC processing fee (সাধারণত 1500)। Customer নিজে দিলে 0 দিন।</div></div>
      <div class="field" style="grid-column:1/-1"><label>Official Website URL (booking sheet-এ দেখাবে)</label><input name="official_site_url" value="${esc(s.official_site_url)}"></div>
      <div class="field"><label>Accept New Applications</label>
        <select name="accept_new"><option value="1" ${s.accept_new === '1' ? 'selected' : ''}>Open</option><option value="0" ${s.accept_new === '0' ? 'selected' : ''}>Closed</option></select></div>
    </div>
  </div>
  <div class="panel"><h3>Visa Centers (IVAC locations)</h3>
    <div id="centerChips" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      ${s.centers.map(c => `<span class="pill" style="background:#334155">${esc(c)} <a href="javascript:rmCenter('${esc(c)}')" style="color:#fca5a5;margin-left:6px">✕</a></span>`).join('')}
    </div>
    <div class="grid2"><input id="newCenter" placeholder="New center name…"></div>
    <button type="button" class="btn btn-outline btn-sm" style="margin-top:10px" onclick="addCenter()">+ Add Center</button>
    <input type="hidden" name="centers_json" id="centersJson" value="${esc(JSON.stringify(s.centers))}">
  </div>
  <div class="panel"><h3>Admin Password</h3>
    <div class="grid2">
      <div class="field"><label>Current Password</label><input type="password" name="current_password"></div>
      <div class="field"><label>New Password (min 8 chars)</label><input type="password" name="new_password"></div>
    </div>
  </div>
  <div id="setMsg" class="errors" style="display:none"></div>
  <button class="btn btn-primary" type="submit">Save Settings</button>
  </form>`;
}
let CENTERS = [];
async function saveSettings(e) {
  e.preventDefault();
  const f = e.target;
  const body = {
    business_name: f.business_name.value, bkash_number: f.bkash_number.value,
    service_fee: f.service_fee.value, official_fee: f.official_fee.value,
    official_site_url: f.official_site_url.value, accept_new: f.accept_new.value === '1',
    centers: JSON.parse(f.centers_json.value),
    current_password: f.current_password.value, new_password: f.new_password.value
  };
  const msg = document.getElementById('setMsg');
  try { await post('/api/admin/settings', body); msg.style.display = 'block'; msg.style.background = '#dcfce7'; msg.style.color = '#166534'; msg.style.borderColor = '#bbf7d0'; msg.textContent = '✓ Saved!'; setTimeout(() => { msg.style.display = 'none'; }, 2000); }
  catch (er) { msg.style.display = 'block'; msg.textContent = er.message; }
}
function addCenter() {
  const v = document.getElementById('newCenter').value.trim();
  if (!v) return;
  const arr = JSON.parse(document.getElementById('centersJson').value);
  arr.push(v); document.getElementById('centersJson').value = JSON.stringify(arr);
  go('settings');
}
function rmCenter(c) {
  const arr = JSON.parse(document.getElementById('centersJson').value).filter(x => x !== c);
  document.getElementById('centersJson').value = JSON.stringify(arr);
  go('settings');
}

/* ---------- init ---------- */
document.addEventListener('submit', e => { if (e.target.id === 'setForm') saveSettings(e); });
api('/api/admin/me').then(() => {
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('appView').hidden = false;
  render();
}).catch(() => {});

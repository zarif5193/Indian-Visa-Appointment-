/* Customer status check + correction form */
let CUR = null;

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(iso) { if (!iso) return ''; const d = new Date(iso); return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }

async function check() {
  const ref = document.getElementById('cRef').value.trim();
  const mobile = document.getElementById('cMobile').value.trim();
  const box = document.getElementById('checkErrors');
  box.innerHTML = '';
  if (!ref || !mobile) { box.innerHTML = '<div class="errors">Application ID ও mobile number দুটোই দিতে হবে।</div>'; return; }
  try {
    const r = await fetch(`/api/public/check?ref=${encodeURIComponent(ref)}&mobile=${encodeURIComponent(mobile)}`);
    const j = await r.json();
    if (!r.ok) { box.innerHTML = `<div class="errors">${esc(j.error)}</div>`; document.getElementById('result').hidden = true; return; }
    CUR = j;
    render(j);
  } catch (e) { box.innerHTML = '<div class="errors">Network error — আবার চেষ্টা করুন।</div>'; }
}

function render(j) {
  const el = document.getElementById('result');
  el.hidden = false;
  const m = j.status_meta;
  let html = `
    <div class="status-head">
      <span style="font-family:Consolas,monospace;font-weight:700;font-size:17px">${esc(j.app_ref)}</span>
      <span class="pill" style="background:${m.color}">${esc(m.label)} <small style="opacity:.8">/ ${esc(m.labelEn)}</small></span>
    </div>
    <div class="kv" style="max-width:640px">
      <div><span class="k">Applicant</span><span class="v">${esc(j.name)}</span></div>
      <div><span class="k">Visa</span><span class="v">${esc(j.visa_type)} • Center: ${esc(j.center)}</span></div>
      <div><span class="k">Payment</span><span class="v">BDT ${esc(j.payment_amount)} ${j.payment_verified ? '<span class="badge-verified">Verified ✓</span>' : '<span class="badge-unverified">Verification pending</span>'}</span></div>
    </div>`;

  if (j.notification) {
    const strong = j.status === 'correction_needed' ? '📝 আমাদের পক্ষ থেকে Correction Request:' :
      j.status === 'payment_rejected' ? '❌ Payment verify করা যায়নি:' : '⚠️ ';
    html += `<div class="notice" style="margin-top:16px"><b>${strong}</b> ${esc(j.notification)}</div>`;
  }

  if (j.appointment) {
    html += `
      <div class="appointment-card">
        <h4>✅ Appointment Confirmed</h4>
        <div class="kv">
          <div><span class="k">Date</span><span class="v">${esc(j.appointment.date)}</span></div>
          <div><span class="k">Time</span><span class="v">${esc(j.appointment.time)}</span></div>
          <div><span class="k">Center</span><span class="v">IVAC ${esc(j.appointment.center)}</span></div>
          <div><span class="k">Booking ID</span><span class="v">${esc(j.appointment.booking_id)}</span></div>
        </div>
      </div>`;
  }

  html += `<div style="margin-top:18px"><b>History</b>
    <ul class="timeline">${j.timeline?.map(t => `<li><div class="t-time">${fmt(t.created_at)}</div>${esc(t.note || statusNote(t.status))}</li>`).join('') || ''}</ul></div>`;

  if (j.has_receipt) {
    html += `<a class="btn btn-ok" style="margin-top:8px" href="/api/public/receipt/${encodeURIComponent(j.app_ref)}?token=${encodeURIComponent(j.token)}">⬇️ Receipt Download (PDF)</a>`;
  }
  if (j.can_correct) html += correctionForm(j);

  document.getElementById('resultBody').innerHTML = html;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function statusNote(s) {
  const map = {
    submitted: 'Application received — payment verification pending',
    payment_rejected: 'Payment rejected — please correct & resubmit',
    correction_needed: 'Correction requested by service',
    approved: 'Application accepted — booking queue-তে আছে',
    booking_in_progress: 'Booking in progress',
    slot_found: 'Slot found — confirming booking',
    booked: 'Booking complete ✓',
    booking_failed: 'Booking attempt failed — we are following up',
    rejected: 'Application rejected'
  };
  return map[s] || s;
}

function correctionForm(j) {
  const v = j.values || {};
  const f = (name, label, type = 'text', req = 0) =>
    `<div class="field"><label>${label} ${req ? '<span class="req">*</span>' : ''}</label><input name="${name}" type="${type}" value="${esc(v[name] || '')}"></div>`;
  return `
  <div class="panel" style="margin-top:22px">
    <h3>📝 Correction / নতুন তথ্য দিলে status আবার pending হবে</h3>
    <p style="font-size:13px;color:var(--muted);margin-bottom:14px">শুধু যেসব field-এ পরিবর্তন দরকার তার value বদলান — বাকিগুলো যেমন আছে তেমনি submit করলেও হবে। নতুন ছবি/ডকুমেন্ট দিলে পুরনোটির জায়গায় এটা বসবে।</p>
    <form id="corrForm">
      <input type="hidden" name="ref" value="${esc(j.app_ref)}">
      <div class="grid2">
        ${f('full_name', 'Full Name', 'text', 1)}
        ${f('mobile', 'Mobile', 'tel', 1)}
        ${f('email', 'Email')}
        ${f('address', 'Address', 'text', 1)}
        ${f('passport_number', 'Passport Number', 'text', 1)}
        ${f('passport_issue_date', 'Passport Issue Date', 'date')}
        ${f('passport_expiry_date', 'Passport Expiry Date', 'date')}
        ${f('visa_type', 'Visa Type')}
        ${f('entry_type', 'Entry Type')}
        ${f('arrival_date', 'Arrival Date', 'date')}
        ${f('departure_date', 'Departure Date', 'date')}
        ${f('visa_center', 'Visa Center')}
        ${f('pref_earliest', 'Preferred Earliest', 'date')}
        ${f('pref_latest', 'Preferred Latest', 'date')}
        ${f('payment_amount', 'Payment Amount (BDT)', 'number')}
        ${f('payment_trx_id', 'bKash Transaction ID', 'text', 1)}
        ${f('payment_date', 'Payment Date/Time', 'datetime-local')}
        ${f('payment_from_number', 'Paid From bKash Number', 'tel', 1)}
      </div>
      <div class="grid1" style="margin-top:14px">
        ${f('purpose_detail', 'Purpose of Visit')}
      </div>
      <div class="upload-grid" style="margin-top:14px">
        <div class="upload-box"><b>New Photo (optional)</b><div class="hint">Old photo-র জায়গায় বসবে।</div><input type="file" name="photo" accept="image/*"></div>
        <div class="upload-box"><b>New Documents (optional, max 4)</b><input type="file" name="extra_doc" multiple accept="image/*,application/pdf"></div>
      </div>
      <div id="corrErr" style="margin-top:12px"></div>
      <button class="btn btn-primary" style="margin-top:14px" type="submit">Submit Correction</button>
    </form>
  </div>`;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('corrForm')?.addEventListener('submit', doCorrect);
});
// delegated binding (form is rendered dynamically)
document.addEventListener('submit', e => { if (e.target.id === 'corrForm') doCorrect(e); });

async function doCorrect(e) {
  if (e) e.preventDefault();
  const form = e ? e.target : document.getElementById('corrForm');
  const fd = new FormData(form);
  const err = document.getElementById('corrErr');
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const r = await fetch('/api/public/correct', { method: 'POST', body: fd });
    const j = await r.json();
    if (!r.ok) { err.innerHTML = `<div class="errors">${esc(j.error)}</div>`; return; }
    check();
  } catch (e2) { err.innerHTML = '<div class="errors">Network error — আবার চেষ্টা করুন।</div>'; }
  finally { btn.disabled = false; btn.textContent = 'Submit Correction'; }
}
